# Think Tank — Next.js Frontend Redesign

## Overview

Replace the Streamlit frontend with a Next.js app. Keep the Flask API backend and extend it with new endpoints. The app is a personal idea capture and browsing tool — text, images, sketches, and videos — with two-tier search (instant fuzzy + semantic) and auto-categorization. It runs on a Tailnet, protected by a simple password gate.

**Key constraint:** Speed is a first-class requirement. Every interaction — capturing, browsing, searching — must feel instant. Optimistic UI, parallel uploads, async processing, no spinners.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                              │
│                                                              │
│  ┌────────────────┐         ┌────────────────┐              │
│  │  Next.js        │────────▶│  Flask API     │              │
│  │  :3000          │  HTTP   │  :6000         │              │
│  │                 │◀────────│                │              │
│  │  - UI (React)   │         │  - /add_note   │ (existing)   │
│  │  - Auth gate    │         │  - /ideas      │ (new)        │
│  │  - Theme engine │         │  - /search     │ (new)        │
│  │  - Sketch pad   │         │  - /upload     │ (new)        │
│  │  - Fuse.js      │         │  - /categories │ (new)        │
│  └────────────────┘         └───────┬────────┘              │
│                                     │                        │
│                         ┌───────────┴───────────┐           │
│                         │                       │           │
│                    ┌────▼────┐          ┌───────▼──┐        │
│                    │ notes.db│          │ uploads/ │        │
│                    │ (bind)  │          │ (bind)   │        │
│                    └─────────┘          └──────────┘        │
│                                                              │
│  External (unchanged):                                       │
│  - iPhone Shortcuts → POST /add_note on Flask :6000          │
│  - Cron 8am → docker exec send_daily_email.py                │
│  - healthcheck.py (optional cron)                            │
└─────────────────────────────────────────────────────────────┘
```

### Containers

| Service | Image | Command | Port | Volumes |
|---------|-------|---------|------|---------|
| `nextjs` | `think_tank_frontend` | `node server.js` (production) | 3000 | none |
| `flask` | `think_tank_api` | `gunicorn -b 0.0.0.0:6000 app:app` | 6000 | `notes.db`, `uploads/` |

### Bind Mounts (Host Paths)

```yaml
volumes:
  - /home/ardi/think_tank/notes.db:/app/notes.db
  - /home/ardi/think_tank/uploads:/app/uploads
```

### Environment Variables

```env
# Flask
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_DEFAULT_SENDER=...

# Next.js (server-side only — NOT prefixed with NEXT_PUBLIC_)
API_URL=http://flask:6000               # Internal Docker network, used by Next.js API routes
THINK_TANK_PASSWORD=...                  # Password gate
COOKIE_SECRET=...                        # Signs auth cookie
```

### Network

- **The browser never talks to Flask directly.** All API calls go through Next.js API routes, which proxy to Flask over Docker's internal network (`http://flask:6000`). This avoids CORS issues entirely and keeps Flask unexposed to the browser.
- Next.js serves the UI on port 3000 and proxies API/media requests to Flask
- iPhone Shortcuts talk to Flask on port 6000 directly (separate path, no browser involved)
- No CORS configuration needed — all browser requests stay same-origin

### API Proxy (Next.js → Flask)

Next.js API routes in `app/api/` proxy requests to Flask. The browser calls `/api/ideas`, Next.js forwards to `http://flask:6000/ideas`. This is configured via Next.js rewrites in `next.config.ts`:

```typescript
// next.config.ts
async rewrites() {
  return [
    {
      source: '/api/flask/:path*',
      destination: `${process.env.API_URL}/:path*`,
    },
  ];
}
```

Media files (images, videos, sketches) are also proxied: the browser requests `/api/flask/uploads/47_sketch.png`, Next.js fetches from `http://flask:6000/uploads/47_sketch.png`. This keeps Flask completely behind Next.js.

---

## Tech Stack

### Frontend

| Package | Purpose |
|---------|---------|
| `next` (App Router) | React framework, SSR/SSG |
| `react`, `react-dom` | UI library |
| `typescript` | Type safety |
| `tailwindcss` | Utility CSS |
| `shadcn/ui` | Component library (Drawer, Command, Tabs, Badge, Toast, Button, Input, Dialog) |
| `react-bits` | Animated effects (gradient text, spotlight, aurora, magnet) |
| `framer-motion` | Page transitions, layout animations |
| `fuse.js` | Client-side fuzzy search |
| `react-sketch-canvas` | Drawing/sketch pad for iPad |
| `browser-image-compression` | Client-side image compression before upload |
| `react-window` | Virtualized list for idea feed (60fps scrolling) |
| `swr` | Data fetching with caching, revalidation, and optimistic updates |

### Backend

| Package | Purpose |
|---------|---------|
| `flask` | REST API framework |
| `gunicorn` | WSGI server |
| `sentence-transformers` | Local embedding model (`nomic-embed-text-v1.5`) |
| `scikit-learn` | Cosine similarity |
| `flask-cors` | CORS headers (only needed if proxy approach changes) |
| `pillow` | Image validation and metadata reading |
| `python-dotenv` | Environment loading |
| `pytz` / `tzdata` | Timezone handling |

### Embedding Model

- **Model:** `nomic-embed-text-v1.5` (~550MB)
- **Loaded once** on Flask startup, kept in memory
- **Used for:** Semantic search embeddings + auto-categorization
- **Replaces:** OpenAI `text-embedding-3-small` (no external API dependency)

---

## Database Schema

### `ideas` table (modified)

```sql
CREATE TABLE IF NOT EXISTS ideas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content         TEXT NOT NULL DEFAULT '',     -- idea text, empty string for image-only ideas
    timestamp       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- Vancouver timezone (app always provides explicitly)
    embedding       TEXT,                        -- JSON array from nomic-embed-text-v1.5
    media_type      TEXT NOT NULL DEFAULT 'text', -- 'text', 'image', 'sketch', 'video', 'mixed'
    has_media       INTEGER NOT NULL DEFAULT 0,  -- 0 or 1, quick filter flag
    category_id     INTEGER REFERENCES categories(id) -- auto-assigned, manually overridable
);
```

### `idea_media` table (new)

```sql
CREATE TABLE IF NOT EXISTS idea_media (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id         INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,               -- stored filename, e.g. '47_photo.jpg'
    original_name   TEXT,                        -- what the user uploaded
    media_type      TEXT NOT NULL,               -- 'image', 'sketch', 'video'
    file_size       INTEGER,                     -- bytes, for display
    created_at      DATETIME NOT NULL            -- Vancouver timezone
);
```

### `categories` table (new)

```sql
CREATE TABLE IF NOT EXISTS categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,         -- display name
    color           TEXT,                         -- hex color for badge, e.g. '#a78bfa'
    embedding       TEXT,                         -- JSON array, category description embedding
    sort_order      INTEGER NOT NULL DEFAULT 0    -- for UI ordering
);
```

### Default categories (seeded on first run)

| name | color |
|------|-------|
| Tech / Experiments | `#60a5fa` (blue) |
| Music | `#a78bfa` (purple) |
| Books | `#34d399` (green) |
| Personal / Philosophical | `#f472b6` (pink) |
| Productivity | `#facc15` (yellow) |
| Gym / Health | `#fb923c` (orange) |
| Misc | `#71717a` (gray) |

### Migration strategy

- `init_db()` on Flask startup handles all migrations (existing pattern)
- Add `media_type`, `has_media`, `category_id` columns to `ideas` if missing (`ALTER TABLE ADD COLUMN` — SQLite allows adding columns with defaults)
- The existing `content` column is `TEXT NOT NULL` — we keep it that way. Image-only ideas use an empty string `''` for content.
- Create `idea_media` and `categories` tables if missing
- Seed default categories if `categories` table is empty (generate category embeddings with nomic at seed time)
- Backfill: set all existing ideas to `media_type='text'`, `has_media=0` (via UPDATE)
- Backfill: regenerate **all** embeddings with nomic model — existing embeddings were generated by OpenAI `text-embedding-3-small` (different model, different dimensionality, incompatible). This is a one-time migration script (`migrate_embeddings.py`) run manually after deploy.
- Backfill: auto-categorize all existing ideas using the new nomic embeddings
- The existing `ideas_categorized` table (from `categorize_ideas.py` using `all-mpnet-base-v2`) becomes obsolete — left in DB but ignored
- `todo` and `completed_todo` tables left untouched but unused
- `categorize_ideas.py` becomes obsolete — its functionality is now built into Flask's auto-categorization

### Relationships

```
categories (1) ──── (many) ideas (1) ──── (many) idea_media
```

---

## API Endpoints

### Existing (unchanged)

#### `POST /add_note`
iPhone Shortcuts endpoint. Stays exactly as-is.

```
Request:  { "content": "idea text" }
Response: 201 { "message": "Note added successfully." }
```

**Change:** After inserting the idea, queue embedding generation + auto-categorization in a background thread. The response returns immediately without waiting.

### New Endpoints

#### `GET /ideas`

Returns all ideas with their media and category info. Used by the frontend to load everything into memory for fuzzy search.

```
Request:  GET /ideas
Response: 200
{
    "ideas": [
        {
            "id": 47,
            "content": "Try wavetable synth plugin",
            "timestamp": "2026-03-22 14:34:00",
            "media_type": "mixed",
            "has_media": true,
            "category": {
                "id": 3,
                "name": "Music",
                "color": "#a78bfa"
            },
            "media": [
                {
                    "id": 12,
                    "filename": "47_sketch.png",
                    "media_type": "sketch",
                    "file_size": 45200,
                    "url": "/api/flask/uploads/47_sketch.png"
                }
            ]
        }
    ],
    "total": 342
}
```

**Performance:** Single query with JOINs. No pagination — all ideas loaded at once (for a personal app, even thousands of ideas is small). Media URLs are relative paths proxied through Next.js (e.g., `/api/flask/uploads/47_sketch.png`).

#### `POST /ideas`

Create an idea from the web app (richer than `/add_note`). Supports text + category.

```
Request:  { "content": "idea text", "category_id": 3 }
Response: 201 { "id": 47, "message": "Idea saved." }
```

If `category_id` is omitted, auto-categorization runs (background thread). If provided, it's used directly.

#### `PATCH /ideas/<id>`

Update an idea's text or category (for manual category override).

```
Request:  { "category_id": 5 }
Response: 200 { "message": "Idea updated." }
```

#### `DELETE /ideas/<id>`

Delete an idea and its associated media files.

```
Request:  DELETE /ideas/47
Response: 200 { "message": "Idea deleted." }
```

Also deletes files from `uploads/` and rows from `idea_media`.

#### `POST /search`

Semantic search using nomic embeddings.

```
Request:  { "query": "music production tools" }
Response: 200
{
    "results": [
        {
            "id": 47,
            "content": "Try wavetable synth plugin",
            "timestamp": "2026-03-22 14:34:00",
            "similarity": 0.847,
            "category": { "id": 3, "name": "Music", "color": "#a78bfa" }
        }
    ]
}
```

Returns top 20 results sorted by similarity score. Threshold: only return results with similarity > 0.3.

#### `POST /upload`

Upload media files (images, sketches, videos).

```
Request:  multipart/form-data
          - idea_id: 47
          - file: <binary>
Response: 201
{
    "id": 12,
    "filename": "47_photo.jpg",
    "url": "/api/flask/uploads/47_photo.jpg"
}
```

**Constraints:**
- Max file size: 500MB (for videos)
- Accepted MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `video/quicktime`, `video/webm`
- Files saved as `{idea_id}_{original_name}` in `uploads/`
- If the idea's `media_type` is `'text'`, update it to `'image'`/`'video'`/`'mixed'` as appropriate
- Set `has_media = 1`

#### `GET /uploads/<filename>`

Serve media files from the `uploads/` directory. Standard static file serving.

#### `GET /categories`

List all categories.

```
Response: 200
{
    "categories": [
        { "id": 1, "name": "Tech / Experiments", "color": "#60a5fa", "sort_order": 0 },
        ...
    ]
}
```

#### `POST /categories`

Create a new category.

```
Request:  { "name": "Design", "color": "#ec4899" }
Response: 201 { "id": 8, "message": "Category created." }
```

Also generates and stores the category embedding for auto-categorization.

#### `PATCH /categories/<id>`

Update a category name or color.

#### `DELETE /categories/<id>`

Delete a category. Ideas in this category get reassigned to "Misc".

---

## Authentication

### Flow

1. User visits any page on Next.js
2. Next.js middleware checks for `think_tank_auth` cookie
3. If missing or invalid → redirect to `/login`
4. `/login` page shows a single password input with aurora background (React Bits)
5. User enters password → `POST /api/auth` (Next.js API route, not Flask)
6. Next.js compares against `THINK_TANK_PASSWORD` env var
7. On match → set `think_tank_auth` HTTP-only signed cookie (30-day expiry)
8. Redirect to `/`

### Cookie

```
Name:     think_tank_auth
Value:    signed JWT or HMAC token using COOKIE_SECRET
HttpOnly: true
SameSite: Lax
Secure:   false (Tailnet, no HTTPS)
MaxAge:   30 days (2592000 seconds)
Path:     /
```

### What is NOT authenticated

- Flask API (port 6000) — no auth. iPhone Shortcuts and the daily email script need direct access.
- The Next.js app handles all auth. Flask trusts requests from Next.js on the Docker internal network.

---

## Frontend

### Project Structure

```
frontend/
├── app/
│   ├── layout.tsx              # Root layout, theme provider, font loading
│   ├── page.tsx                # Main app (ideas feed)
│   ├── login/
│   │   └── page.tsx            # Password gate
│   ├── api/
│   │   └── auth/
│   │       └── route.ts        # Auth API route (password check, cookie set)
│   │                           # Note: Flask proxy is handled via next.config.ts rewrites, not API routes
│   └── globals.css             # Tailwind base + theme CSS variables
├── components/
│   ├── ui/                     # shadcn/ui components (auto-generated)
│   ├── ideas/
│   │   ├── idea-feed.tsx       # Main scrollable list of ideas grouped by date
│   │   ├── idea-card.tsx       # Single idea card (text, media preview, category badge)
│   │   ├── idea-detail.tsx     # Expanded view of an idea (full media, edit category)
│   │   └── capture-sheet.tsx   # Bottom sheet for creating ideas (text, media, sketch, category)
│   ├── search/
│   │   ├── search-bar.tsx      # Search input with fuzzy/semantic toggle
│   │   ├── search-results.tsx  # Search results list with relevance scores
│   │   └── search-provider.tsx # Context provider: loads all ideas, initializes Fuse.js
│   ├── sketch/
│   │   └── sketch-pad.tsx      # react-sketch-canvas wrapper with save/clear/undo
│   ├── categories/
│   │   ├── category-filter.tsx # Horizontal scrollable pills for filtering
│   │   ├── category-badge.tsx  # Colored badge component
│   │   └── category-manager.tsx# Settings view: add/edit/delete categories
│   ├── layout/
│   │   ├── bottom-nav.tsx      # iOS-style bottom tab bar
│   │   ├── header.tsx          # App header with gradient text + settings icon
│   │   └── fab.tsx             # Floating action button with magnet effect
│   ├── auth/
│   │   └── password-gate.tsx   # Login form with aurora background
│   └── theme/
│       ├── theme-provider.tsx  # Theme context (dark/neutral/glass)
│       └── theme-selector.tsx  # Theme picker in settings
├── lib/
│   ├── api.ts                  # Flask API client (fetch wrappers, error handling)
│   ├── types.ts                # TypeScript types for Idea, Category, Media, etc.
│   ├── hooks/
│   │   ├── use-ideas.ts        # SWR/React Query hook for ideas data
│   │   ├── use-search.ts       # Combined fuzzy + semantic search hook
│   │   ├── use-categories.ts   # Categories data hook
│   │   └── use-upload.ts       # File upload with compression + progress
│   └── utils/
│       ├── dates.ts            # Date formatting, grouping by day
│       ├── compress.ts         # Client-side image compression
│       └── theme.ts            # Theme CSS variable maps
├── middleware.ts               # Auth cookie check, redirect to /login
├── Dockerfile                  # Multi-stage build (build + slim runtime)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### Routing

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `page.tsx` | Main app — ideas feed (default tab) |
| `/login` | `login/page.tsx` | Password gate |

The three tabs (Ideas, Search, Categories) are rendered within the main page using client-side state, not separate routes. This avoids page loads on tab switch — tabs are instant.

### Tabs

| Tab | Icon | Content |
|-----|------|---------|
| Ideas | 💡 | Idea feed grouped by date, category filter pills at top |
| Search | 🔍 | Search bar + results (fuzzy as-you-type, deep search on Enter) |
| Categories | 📂 | Grid/list of categories with idea counts, tap to filter |

### Themes

Three themes, switchable from settings. Implemented via CSS custom properties on `:root`.

**Minimal Dark:**
```css
--background: #0a0a0a;
--foreground: #fafafa;
--card: #141414;
--card-border: #1a1a1a;
--muted: #555;
--accent: #fafafa;
```

**Soft Neutral:**
```css
--background: #f8f7f4;
--foreground: #1a1a1a;
--card: #ffffff;
--card-border: #e8e6e1;
--muted: #999;
--accent: #1a1a1a;
```

**Glass Modern:**
```css
--background: #0f0f1a;
--foreground: #e0e0e0;
--card: rgba(255,255,255,0.05);
--card-border: rgba(255,255,255,0.08);
--muted: #666;
--accent: linear-gradient(90deg, #a78bfa, #60a5fa);
```

Theme preference stored in `localStorage`. Default: Minimal Dark.

### React Bits Effects

| Effect | Where | Purpose |
|--------|-------|---------|
| Gradient text | Header "think tank" | Subtle animated gradient, alive but not distracting |
| Spotlight cursor | Idea cards (desktop) | Glow follows cursor on hover |
| Aurora background | Login/password screen | Dreamy animated gradient sets the mood |
| Magnet effect | FAB (+) button | Button subtly pulls toward finger/cursor |
| Count-up animation | Category view (idea counts) | Numbers animate up on load |

### Capture Flow (Bottom Sheet)

1. User taps FAB (+) → shadcn `Drawer` slides up from bottom
2. **The Drawer component stays mounted at all times** — it's rendered hidden in the DOM and toggled via state. No mount/unmount cycle on open.
3. Contents:
   - Text input (auto-focused)
   - Media buttons row: Photo (opens file picker), Sketch (opens sketch pad), Video (opens file picker)
   - Category chips (auto-selected, tappable to override)
   - Save button
4. On save:
   - Optimistic: idea immediately appears in the feed
   - `POST /ideas` sends text + category → returns `{ id: 47 }`
   - **Then**, if media attached: `POST /upload` sends files with `idea_id=47` (multiple files upload in parallel, but all wait for the idea ID first)
   - If idea creation fails: toast error, remove optimistic entry
   - If upload fails: toast warning, idea still saved (text-only), user can retry upload
5. Drawer dismisses on save or swipe down

### Sketch Pad

- Uses `react-sketch-canvas`
- Opens as a full-screen overlay on top of the capture sheet
- Controls: pen color, pen size, undo, clear, done
- On "Done": exports canvas as PNG blob, attaches to the idea being created
- Supports Apple Pencil pressure sensitivity

---

## Search

### Tier 1: Instant Fuzzy Search (Client-Side)

- **Library:** Fuse.js
- **Data:** All ideas loaded into browser memory on app load via `GET /ideas`
- **Indexed fields:** `content` (weighted 1.0)
- **Behavior:** Results update on every keystroke. Typo-tolerant. No network requests.
- **Threshold:** Fuse.js default (0.6) — tunable
- **Results:** Rendered immediately below the search bar, replaces the ideas feed

### Tier 2: Semantic Deep Search (Server-Side)

- **Trigger:** User presses Enter or taps "Deep Search" button
- **Flow:** `POST /search` → Flask generates query embedding with nomic → cosine similarity against all stored idea embeddings → return top 20 results
- **Visual distinction:** Deep search results show a relevance percentage badge (e.g., "87% match")
- **Loading state:** Skeleton loader while waiting (not a spinner)

### Combined UX

```
┌─────────────────────────────────────┐
│  🔍 Search ideas...           [Deep]│  ← single search bar
├─────────────────────────────────────┤
│                                     │
│  As you type → fuzzy results        │
│  Press Enter or tap Deep →          │
│    semantic results with scores     │
│                                     │
└─────────────────────────────────────┘
```

---

## Auto-Categorization

### How It Works

1. On idea creation (both `/add_note` and `/ideas`), if no `category_id` is provided:
2. Background thread: generate embedding for the idea text using nomic
3. Compare (cosine similarity) against all category embeddings stored in `categories.embedding`
4. Assign the category with the highest similarity score
5. Update the idea's `category_id`

### Category Embeddings

Each category has a stored embedding generated from a descriptive prompt:

```python
category_descriptions = {
    "Tech / Experiments": "technology, programming, software, hardware, coding, experiments, tools, APIs, apps",
    "Music": "music, instruments, synths, plugins, production, songs, albums, concerts, audio",
    "Books": "books, reading, literature, authors, novels, articles, writing",
    "Personal / Philosophical": "personal life, philosophy, thoughts, reflections, relationships, meaning",
    "Productivity": "productivity, workflow, habits, systems, efficiency, organization, planning",
    "Gym / Health": "gym, exercise, fitness, health, nutrition, diet, workout, running",
    "Misc": "miscellaneous, random, other, general"
}
```

When a new category is created, the user provides a name and we generate the embedding from the name (or optionally a description).

### Performance

The nomic model is already in memory for search. Auto-categorization is a single cosine similarity computation against ~7 category vectors — effectively free (~1ms).

---

## Performance Requirements

### Capture Speed

| Action | Target | How |
|--------|--------|-----|
| Bottom sheet open | < 50ms | Sheet stays mounted, CSS transform toggle |
| Idea save (perceived) | Instant | Optimistic UI — idea appears in feed before API responds |
| Idea save (actual) | < 200ms | Flask inserts row and returns. Embedding + categorization are async |
| Image upload start | Instant | Upload begins on file selection, not on save |
| Image compression | < 500ms | Client-side, resize to max 1920px before upload |

### Browsing Speed

| Action | Target | How |
|--------|--------|-----|
| Initial app load | < 1s (shell) | Next.js static shell renders instantly, data loads after |
| Ideas data load | < 500ms | Single `GET /ideas` query, all ideas in one response |
| Tab switch | Instant | All tabs pre-rendered, state toggle only |
| Fuzzy search | < 16ms/keystroke | Fuse.js in-memory, no network |
| Scroll performance | 60fps | Virtualized list via react-window (enabled by default) |

### Search Speed

| Action | Target | How |
|--------|--------|-----|
| Fuzzy search | < 16ms | Client-side Fuse.js |
| Semantic search | < 1s | Query embedding (~50ms) + cosine similarity (~10ms) + network |
| Model cold start | 0ms | Model loaded on Flask startup, stays warm |

### Upload Constraints

| Constraint | Value |
|------------|-------|
| Max file size | 500MB |
| Image compression target | Max 1920px on longest side |
| Compression quality | 0.8 JPEG |
| Parallel uploads | Yes — text + media go simultaneously |

### Implementation Techniques

- **Optimistic UI:** Use SWR's `mutate()` to instantly update the local cache before the API responds. On error, revert.
- **Pre-mounted components:** The capture sheet and sketch pad are rendered in the DOM at all times, toggled via CSS/state. No mount/unmount overhead.
- **Image thumbnails:** Client-side compression via `browser-image-compression` handles this. Images are compressed before upload (max 1920px, 0.8 quality). The compressed version is what gets stored and served in the feed. For detail view, the same file is shown — it's already good enough quality for a personal app. No server-side thumbnail generation needed.
- **Skeleton loaders:** All loading states use skeleton components (shadcn Skeleton), never spinners.
- **React.memo:** Idea cards wrapped in `React.memo` to prevent unnecessary re-renders on feed updates.
- **Virtualized list:** Use `react-window` for the ideas feed from the start. The database already has 500+ ideas, so virtualization is needed immediately. This ensures 60fps scrolling regardless of idea count.

---

## Deployment

### Docker Compose

```yaml
services:
  flask:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: think_tank_api
    command: gunicorn -b 0.0.0.0:6000 -w 2 --threads 4 app:app
    ports:
      - "6000:6000"
    volumes:
      - /home/ardi/think_tank/notes.db:/app/notes.db
      - /home/ardi/think_tank/uploads:/app/uploads
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - MAIL_SERVER=${MAIL_SERVER}
      - MAIL_PORT=${MAIL_PORT}
      - MAIL_USE_TLS=${MAIL_USE_TLS}
      - MAIL_USERNAME=${MAIL_USERNAME}
      - MAIL_PASSWORD=${MAIL_PASSWORD}
      - MAIL_DEFAULT_SENDER=${MAIL_DEFAULT_SENDER}
    restart: always

  nextjs:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: think_tank_frontend
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://flask:6000
      - THINK_TANK_PASSWORD=${THINK_TANK_PASSWORD}
      - COOKIE_SECRET=${COOKIE_SECRET}
    depends_on:
      - flask
    restart: always
```

### Dockerfile.api (Flask)

```dockerfile
FROM python:3.13-slim
WORKDIR /app

# Install system deps for sentence-transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the nomic model at build time so startup is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)"

COPY . .

RUN mkdir -p /app/uploads
```

### frontend/Dockerfile (Next.js)

```dockerfile
# Build stage
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Deploy Script

Updated `deploy.sh`:
```bash
cd /home/ardi/think_tank
docker build -t think_tank_api -f Dockerfile.api .
docker build -t think_tank_frontend -f frontend/Dockerfile frontend/
docker compose up -d --force-recreate
docker compose ps
```

### Migration from Streamlit

1. Build and start the new containers
2. Verify everything works on port 3000
3. Run `migrate_embeddings.py` to regenerate all embeddings with nomic and auto-categorize existing ideas
4. Remove the old Streamlit service from docker-compose
5. Update any bookmarks/shortcuts from :8502 to :3000
6. Old `stl.py` can be deleted once confirmed
7. Update `healthcheck.py` — change container names from `think_tank-streamlit-1` to `think_tank_frontend`
8. Update `send_daily_email.py` — remove the "Top 5 Tasks" section (todo feature is deprecated), keep the "Today's Ideas" section, optionally add category labels to ideas in the email
9. Old `Dockerfile` (the one that built the combined Streamlit+Flask image) should be renamed or deleted — it's replaced by `Dockerfile.api` and `frontend/Dockerfile`

---

## File & Directory Conventions

### Naming

- **React components:** kebab-case files (`idea-card.tsx`, `capture-sheet.tsx`)
  - This matches shadcn/ui's convention (`button.tsx`, `drawer.tsx`) for consistency
- **Hooks:** `use-` prefix, kebab-case (`use-ideas.ts`)
- **Utilities:** kebab-case (`dates.ts`, `compress.ts`)
- **API client:** single file `lib/api.ts` with named exports per endpoint
- **Types:** single file `lib/types.ts` for shared types

### Adding a New Feature (Guide for Future Development)

When adding a new feature to Think Tank, follow this pattern:

0. **Update the spec first** — before writing code, add the feature to this design doc (or a new doc in `docs/superpowers/specs/`). Document: what it does, schema changes, new endpoints, new components. This ensures future sessions have context.

1. **Define the data** — if the feature needs new data:
   - Add the table/columns in `app.py`'s `init_db()` function (migration style: use `PRAGMA table_info()` to check if column exists, then `ALTER TABLE ADD COLUMN`)
   - Add TypeScript types in `frontend/lib/types.ts`

2. **Add the API endpoint** — in `app.py`:
   - Validate input: check required fields, return `{"error": "..."}` with 400 on failure
   - Use Vancouver timestamps (`America/Vancouver` via `zoneinfo`)
   - Return JSON with appropriate status code
   - Wrap database operations in try/except, return `{"error": "..."}` with 500 on unexpected errors
   - If the endpoint does heavy work (ML, file processing), do it in a background thread (`threading.Thread(target=fn, args=(...)).start()`) and return immediately

3. **Add the API client** — in `frontend/lib/api.ts`:
   - Add a function that calls the new endpoint via the proxy path (`/api/flask/...`)
   - Follow the existing pattern: `async function doThing(params): Promise<Response>`
   - Handle the standard error format: `{ "error": "..." }`

4. **Add the data hook** — in `frontend/lib/hooks/`:
   - Create `use-<feature>.ts`
   - Use SWR for data fetching, optimistic updates for mutations

5. **Build the component** — in `frontend/components/<feature>/`:
   - One directory per feature area
   - Keep components focused — one file per component
   - Use shadcn/ui primitives, don't rebuild standard components
   - Add Framer Motion for transitions where it feels natural
   - Use skeleton loaders for loading states, never spinners

6. **Wire it up** — add the component to the relevant tab or create a new view

7. **Rebuild and deploy** — if you changed backend deps, rebuild Flask image. If you changed frontend deps, rebuild Next.js image. Run `deploy.sh` to deploy both.

### Key Architectural Rules

- **Flask handles all data and ML.** Next.js never touches SQLite or the embedding model directly.
- **Next.js handles all UI and auth.** Flask has no auth, no HTML rendering.
- **Next.js proxies all Flask requests.** The browser never calls Flask directly. All API and media requests go through Next.js rewrites (`/api/flask/*` → `http://flask:6000/*`).
- **Optimistic UI everywhere.** Show the result before the server confirms. Revert on error.
- **Background processing for heavy work.** Embeddings, categorization, and thumbnail generation happen in background threads using `threading.Thread(target=fn, args=(...)).start()`. Never block a request. Note: if a gunicorn worker recycles, in-flight background threads die silently — the idea is saved but the embedding may be missing. The backfill script handles stragglers.
- **All timestamps in Vancouver time.** No UTC. Use `America/Vancouver` timezone consistently.
- **No spinners, only skeletons.** Loading states use shadcn Skeleton component.
- **SQLite connections:** Open a connection per request, close it when done. Do not hold connections across requests.
- **Error response format:** All Flask error responses return `{ "error": "<message>" }` with the appropriate HTTP status code (400 for validation, 404 for not found, 500 for unexpected). The frontend `lib/api.ts` parses this format.
- **Upload filename sanitization:** Files saved as `{idea_id}_{sanitized_name}` where `sanitized_name` strips path separators and special characters, keeping only alphanumeric, hyphens, underscores, and dots.
- **Docker rebuild rule:** If a feature changes backend dependencies (`requirements.txt`), rebuild the Flask image. If it adds frontend dependencies (`package.json`), rebuild the Next.js image. Run `deploy.sh` to rebuild both.

---

## Testing

### Backend (Flask)

- Test with `pytest`
- Key tests:
  - CRUD operations on ideas, categories
  - File upload (various types, size limits, invalid types)
  - Search endpoint (returns ranked results)
  - Auto-categorization assigns reasonable categories
  - Migration script handles existing data correctly

### Frontend (Next.js)

- Component tests with Vitest + Testing Library (lightweight, not comprehensive)
- Key manual tests:
  - Capture flow: text → save → appears in feed
  - Capture flow: text + image → save → appears with thumbnail
  - Sketch: draw → save → appears as image
  - Search: type → fuzzy results appear → Enter → semantic results
  - Category filter: tap pill → feed filters
  - Theme switch: all three themes render correctly
  - Auth: password gate works, cookie persists
  - Mobile: all interactions work on phone-sized screen

---

## Future Features

Ideas for future development. Not in scope for the initial build.

- **Voice capture** — record a voice memo, transcribe with Whisper, save as idea
- **Idea linking** — connect related ideas together, visualize as a graph
- **Daily/weekly digest in-app** — summary view of recent ideas, trends
- **Tags** — freeform tags in addition to categories, for more granular organization
- **Export** — export ideas as Markdown, JSON, or PDF
- **Collaborative ideas** — share specific ideas via link (with optional expiry)
- **AI chat about ideas** — "what ideas have I had about X?" conversational interface
- **Browser extension** — capture ideas from any webpage (highlight text → save)
- **Widget** — iOS widget for quick capture without opening the app
- **Recurring ideas** — flag ideas that keep coming back, surface them
- **Idea refinement** — expand on an idea with AI assistance, turn it into a plan
- **Dark/light auto-switch** — follow system preference for theme
- **Pin ideas** — pin important ideas to the top of the feed
- **Archive** — archive old ideas without deleting them
- **Search history** — see recent searches
- **Bulk operations** — select multiple ideas, bulk categorize/delete/export
