# Think Tank

Personal idea capture app with minimum friction, where speed is the priority. Capture raw thoughts (text, images, sketches, video, voice) from an iPhone. Come back later to search, star, and share.

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

## Prerequisites

**For Docker deployment (recommended):**
- Docker Engine 24+ and Docker Compose v2
- ~4 GB free disk (Ollama model weights ≈ 2 GB)
- An OpenAI API key (only if you want Whisper voice transcription)

**For direct install (no Docker):**
- Python 3.13+
- Node.js 20+ and npm
- (Optional) Ollama running locally for daily AI recaps
- (Optional) OpenAI API key for voice transcription

## Environment

Create a `.env` file in the project root manually (no example file is committed — secrets stay out of git):

```
# Required — Next.js cookie signing
COOKIE_SECRET=<random string>          # generate with: openssl rand -hex 32
THINK_TANK_PASSWORD=<strong password>  # legacy single-user password fallback

# Optional — OpenAI Whisper voice transcription
OPENAI_API_KEY=sk-...

# Optional — Ollama for daily AI recaps
OLLAMA_URL=http://ollama:11434         # http://localhost:11434 when running direct
OLLAMA_MODEL=llama3.2:3b

# Optional — daily email digest + healthcheck alerts (send_daily_email.py, healthcheck.py)
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=you@example.com
MAIL_PASSWORD=<gmail app password>
MAIL_DEFAULT_SENDER=you@example.com
```

## Deploy with Docker (recommended)

```bash
git clone <repo-url> think_tank
cd think_tank

# 1. Create .env manually — see Environment section above

# 2. Create empty db file + uploads dir so the bind mounts work
touch notes.db
mkdir -p uploads

# 3. Build and start (flask + nextjs + ollama)
docker compose up -d --build

# 4. Pull the Ollama model (one-time, for daily recaps)
docker exec -it think_tank_ollama ollama pull llama3.2:3b

# 5. Create users (see "Creating users" below)
docker exec -it think_tank_api python create_users.py
```

**Shortcut for rebuilds:** after the initial deploy, `./deploy.sh` rebuilds both images and force-recreates the containers — use it instead of the manual `docker compose build` steps.

Services:
- Frontend: `http://localhost:3004`
- API: `http://localhost:6000`

**Common operations:**

```bash
# View logs
docker logs think_tank_frontend --tail=50 -f
docker logs think_tank_api --tail=50 -f

# Rebuild after frontend changes
docker compose build --no-cache nextjs && docker compose up -d --force-recreate nextjs

# Rebuild after backend changes
docker compose build --no-cache flask && docker compose up -d --force-recreate flask

# Stop everything
docker compose down
```

## Run directly (no Docker)

For local development without containers.

**Backend (Flask):**

```bash
cd think_tank
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# First run creates notes.db automatically via init_db()
touch notes.db
mkdir -p uploads

# Start the API
gunicorn -b 0.0.0.0:6000 -w 1 --threads 4 --preload app:app
# or for hot reload during dev:
# FLASK_APP=app.py flask run --port 6000
```

**Frontend (Next.js):**

```bash
cd frontend
npm install

# Point the frontend at your local Flask
export API_URL=http://localhost:6000
export COOKIE_SECRET=<same as .env>
export PORT=3004

npm run dev        # dev mode with hot reload
# or for production:
# npm run build && npm start
```

Open `http://localhost:3004`.

## Creating users

`create_users.py` seeds a fixed set of users (`aardi`, `alexag`, `aaronr`) and the default 7 categories for each. Passwords are entered interactively via `getpass` — they are never echoed to the terminal or saved to disk.

```bash
# Docker
docker exec -it think_tank_api python create_users.py

# Direct install
python3 create_users.py
```

To add different usernames, edit the `USERS` list at the top of `create_users.py` before running. Existing users are detected and skipped, so it's safe to re-run.

## Daily email digest (cron)

`send_daily_email.py` queries all ideas captured on the current Vancouver-local date and emails them as an HTML list. It runs **on the host**, not inside Docker, so it reads `notes.db` directly from the bind-mount path.

```bash
# 1. Fix the DB path at the top of send_daily_email.py if your repo is not at
#    /home/ardi/think_tank (the script hardcodes DB_PATH).

# 2. Install its deps into a venv (shared with the Flask venv is fine)
pip install python-dotenv pytz

# 3. Test it once
python3 send_daily_email.py

# 4. Add to crontab — 8am Vancouver time daily
crontab -e
# 0 8 * * * cd /path/to/think_tank && /path/to/.venv/bin/python send_daily_email.py >> /var/log/think_tank_email.log 2>&1
```

Requires the `MAIL_*` env vars from the Environment section. For Gmail, use an [app password](https://myaccount.google.com/apppasswords), not your account password.

## Healthcheck alerts

`healthcheck.py` inspects the `think_tank_api` and `think_tank_frontend` containers and emails an alert if either is not running.

```bash
# Test once
python3 healthcheck.py

# Run every 5 min via cron
# */5 * * * * cd /path/to/think_tank && /path/to/.venv/bin/python healthcheck.py >> /var/log/think_tank_health.log 2>&1
```

Uses the same `MAIL_*` env vars as the daily digest.

## Expose publicly with Tailscale Funnel

Tailscale Funnel puts your local service on the public internet over HTTPS (valid cert, no port forwarding, no DNS setup). You need Tailscale installed and logged in on the host.

**One-time setup:** there's a helper script — `./setup-funnel.sh` — which runs:

```bash
sudo tailscale funnel --https=10000 --set-path / --bg http://127.0.0.1:3004
```

Flag-by-flag:
- `--https=10000` — Tailscale's public listener. Funnel only allows 443, 8443, and 10000; this config uses 10000 because 443 is taken by other services on the host.
- `--set-path /` — mount the proxy at the URL root (everything under `/` goes to the backend).
- `--bg` — run as a persistent service (survives reboots, detaches from your shell).
- `http://127.0.0.1:3004` — the local upstream to proxy to (Next.js frontend).

Your app is now live at `https://<machine-name>.<tailnet>.ts.net:10000` (e.g. `https://ardi.tail351339.ts.net:10000`). Tailscale issues a Let's Encrypt cert automatically.

**Other useful commands:**

```bash
tailscale funnel status          # show what's currently exposed
sudo tailscale funnel --https=10000 off   # stop exposing
tailscale funnel reset           # tear down all funnel config on this node
tailscale serve status           # serve = tailnet-only; funnel = public
```

**Notes:**
- Funnel must be enabled in the admin console under **Access Controls → Funnel** before the CLI will work.
- The Next.js cookie-auth middleware still runs, so the public URL is gated by the login page — don't disable it.

## Optional — Ollama for daily recaps

```bash
# Install from https://ollama.com
ollama pull llama3.2:3b
ollama serve    # listens on http://localhost:11434
# Then set OLLAMA_URL=http://localhost:11434 in .env
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

- `notes.db` — SQLite, bind-mounted from `./notes.db` in the project root. Init happens automatically on first Flask start (`init_db()` in `app.py`).
- `uploads/` — media files, bind-mounted from `./uploads`. Per-user subdirs: `uploads/<username>/`, `uploads/avatars/`.
- Both are gitignored. Never delete, never commit.
- Back up `notes.db` regularly — the whole app's state lives in that one file. A simple `cp notes.db notes.db.bak-$(date +%Y%m%d)` in cron is enough.
