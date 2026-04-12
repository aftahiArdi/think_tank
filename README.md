# Think Tank

Personal idea capture PWA. Built for ADHD — minimum friction, speed above everything. Capture raw thoughts (text, images, sketches, video, voice) from an iPhone. Come back later to search, star, and share.

## Architecture

```
iPhone PWA (Tailscale Funnel)
  → Next.js 16 frontend       :3004   App shell, auth, API proxy
  → Flask / Gunicorn API      :6000   All data endpoints
  → SQLite (notes.db)                 Single-file database (WAL mode)
  → uploads/                          Media files, per-user subdirectories
```

Both services run as Docker containers via Docker Compose.

## Stack

**Frontend:** Next.js 16 App Router · React 19 · TypeScript · Tailwind · shadcn/ui · SWR · Fuse.js · Vaul · Sonner

**Backend:** Flask · Gunicorn (1 worker, 8 threads) · SQLite WAL · Vancouver timezone throughout

## Features

### Capture
- Text, image, video, voice memo, and freehand sketch
- Bottom sheet with zero friction — no categories at capture time
- Optimistic updates: text ideas appear instantly, media uploads in background
- Mic stream kept alive within a session — no repeated permission prompts

### Ideas feed
- Chronological, grouped by day
- Filter by media type: All · Images · Video · Voice · Sketches
- Pull-to-refresh, starred ideas tab, "Flashback" (on this day in past years)
- Full-text fuzzy search (Fuse.js) + semantic search (OpenAI embeddings)

### Link previews
- YouTube URLs → rich preview card via YouTube oEmbed (thumbnail, title, channel)
- All other URLs → preview card via microlink.io (og:title, og:description, og:image)
- SWR-cached for 1 hour per URL

### Shared feed
- Share any idea to a shared feed visible to all users
- Other users can star shared ideas — appear in their Starred tab with author avatar
- Feed grouped by day, tap any post to open full detail page
- Unshare your own posts

### Multi-user
- Username + password login, HMAC-signed cookie (30-day TTL)
- WebAuthn Face ID lock (sessionStorage, no server round trip)
- Per-user upload directories (`uploads/<username>/`)
- Avatar upload in settings

### Stats
- Idea count breakdown by type (text, image, video, voice, sketch, mixed)
- Animated count-up on load

### Themes
8 built-in themes: Minimal Dark · Soft Neutral · Glass Modern · Midnight · Moonlight · Warm Charcoal · Nord · Forest

### Native iOS feel
- View Transitions API for smooth page slides (iOS 18+ Safari)
- No tap highlight flash, no 300ms delay on buttons/links
- Press-to-scale on cards, antialiased fonts

## Auth flow

1. **Cookie auth** — middleware checks `think_tank_auth` HMAC cookie. Unauthenticated → `/login`.
2. **Face ID lock** — `BiometricGate` wraps all pages, uses WebAuthn. Unlocked state lives in `sessionStorage` only — clears when PWA is closed.

## Running

```bash
# Start
cd /home/ardi/Projects/think_tank
docker compose up -d

# Rebuild frontend after changes
docker compose build --no-cache nextjs && docker compose up -d --force-recreate nextjs

# Rebuild API after changes
docker compose build --no-cache flask && docker compose up -d --force-recreate flask

# Logs
docker logs think_tank_frontend --tail=50
docker logs think_tank_api --tail=50
```

- Frontend: `http://localhost:3004` / `https://ardi.tail351339.ts.net`
- API: `http://localhost:6000`

## Environment

`.env` in the project root:

```
OPENAI_API_KEY=sk-...
COOKIE_SECRET=<random string>
```

## Database schema

SQLite at `notes.db` (bind-mounted, never commit). WAL mode enabled.

| Table | Purpose |
|-------|---------|
| `users` | username, hashed password, avatar_filename |
| `ideas` | content, timestamp, media_type, owner_username, embedding |
| `idea_media` | filename, media_type, file_size, linked to idea |
| `categories` | user-defined categories with color + sort order |
| `idea_categories` | many-to-many ideas ↔ categories |
| `shared_feed` | idea_id, shared_by, shared_at (UNIQUE on idea_id) |
| `feed_stars` | user_id, idea_id (UNIQUE per pair) |

## API conventions

All browser→Flask calls go through the Next.js proxy at `/api/flask/*`. Never call Flask directly from the browser. Direct access (iOS Shortcuts, cron) hits port 6000 on the host.

## Key files

```
app.py                              Flask API (all endpoints)
Dockerfile.api                      Flask Docker image
docker-compose.yml                  Service definitions
send_daily_email.py                 8am daily email digest (cron)
healthcheck.py                      Service health checker

frontend/
  app/
    layout.tsx                      Root layout — BiometricGate, SWR config, service worker
    page.tsx                        Main app shell (tabs: Ideas, Search, Feed, Starred, Stats)
    login/page.tsx                  Login page
    ideas/[id]/page.tsx             Idea detail / edit / share
    feed/[ideaId]/page.tsx          Feed post detail
    api/auth/route.ts               Password login, sets cookie
    api/flask/[...path]/route.ts    Proxy to Flask :6000
    api/yt-preview/route.ts         YouTube oEmbed proxy (cached 1h)
  components/
    auth/                           BiometricGate, PasswordGate, BiometricToggle
    ideas/                          IdeaCard, IdeaFeed, CaptureSheet, Flashback
    feed/                           FeedView, FeedPostCard, AvatarCircle, ShareConfirmSheet
    stats/                          StatsView
    ui/                             GlowCard, VoiceMemoPlayer, YouTubePreview, LinkPreview
  lib/
    api.ts                          All fetch calls to /api/flask/*
    hooks/use-ideas.ts              SWR hook — ideas with optimistic mutations
    hooks/use-feed.ts               SWR hook — feed + starred posts
    biometric.ts                    WebAuthn helpers
  proxy.ts                          Next.js middleware — cookie auth check
  public/sw.js                      Service worker — cache-first for static assets
```

## Data persistence

- `notes.db` — SQLite, bind-mounted at `/home/ardi/Projects/think_tank/notes.db`
- `uploads/` — media files, bind-mounted. Per-user subdirs: `uploads/<username>/`, `uploads/avatars/`
- Both are gitignored. Never delete, never commit.
