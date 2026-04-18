# Think Tank — Project Context

Personal idea/thought capture app. Built for Ardi — ADHD, minimum friction, speed above everything.

## What it is

A PWA (primarily iPhone) for capturing raw thoughts — text, images, sketches, video. No categories at capture time. Ideas are permanent — nothing gets deleted, it's a diary of day-to-day life. You come back later to triage/use ideas, separately from capturing them.

## Stack

```
iPhone PWA
  → Tailscale Funnel (https://ardi.tail351339.ts.net)
  → Next.js 16.2.1 frontend (Docker, port 3004)
  → Flask API backend (Docker, port 6000)
  → SQLite (notes.db) + uploads/
```

**Frontend:** Next.js App Router, React 19, TypeScript, Tailwind, shadcn/ui, SWR, Fuse.js, react-sketch-canvas, vaul (drawer), sonner (toasts)

**Backend:** Flask + Gunicorn (1 worker, 4 threads), SQLite, Vancouver timezone throughout

## Running the app

```bash
# In /home/ardi/Projects/think_tank
docker compose up -d

# Rebuild after frontend changes
docker compose build --no-cache nextjs && docker compose up -d --force-recreate nextjs

# Rebuild after backend changes
docker compose build --no-cache flask && docker compose up -d --force-recreate flask

# Logs
docker logs think_tank_frontend --tail=50
docker logs think_tank_api --tail=50
```

Frontend: http://localhost:3004 (also https://ardi.tail351339.ts.net via Tailscale Funnel)
API: http://localhost:6000

## Auth flow

Two-layer system:

1. **Cookie auth** (server-side): `proxy.ts` middleware checks `think_tank_auth` cookie (HMAC-signed, 30-day TTL). Unauthenticated → redirect to `/login`. Password set in `.env` as `THINK_TANK_PASSWORD`.

2. **Face ID lock** (client-side): `BiometricGate` in root layout wraps all pages. Uses WebAuthn to gate the app on each new PWA session. On success, sets `sessionStorage["tt-unlocked"] = "1"` — no server round trip. Clears when PWA is fully closed. The `/login` page also has a fallback password form via `PasswordGate`.

Auth is skipped in middleware for: `/login`, `/api/auth/*`, `/api/flask/*`, `/manifest.json`, `/sw.js`, icons.

## Key files

```
app.py                          Flask API (all endpoints)
Dockerfile.api                  Flask Docker image
docker-compose.yml              Service definitions
send_daily_email.py             Cron job — 8am daily email digest
healthcheck.py                  Service health checker

frontend/
  app/
    layout.tsx                  Root layout — BiometricGate, SWRConfig, service worker registration
    page.tsx                    Main app shell (tabs: feed, search, sketch, settings)
    login/page.tsx              Login page (Aurora bg + PasswordGate)
    ideas/[id]/page.tsx         Idea detail / edit page
    api/auth/route.ts           POST /api/auth — password login, sets cookie
    api/auth/biometric/route.ts POST /api/auth/biometric — (legacy, not used in current flow)
    api/flask/[...path]/route.ts Proxy — forwards all /api/flask/* to Flask :6000
  components/
    auth/biometric-gate.tsx     WebAuthn Face ID lock (sessionStorage-based, no network)
    auth/biometric-toggle.tsx   Settings toggle to enable/disable Face ID
    auth/password-gate.tsx      Fallback password form on /login
    ideas/idea-feed.tsx         Main feed — Today/All toggle, media filters, pull-to-refresh
    ideas/idea-card.tsx         Individual idea card with GlowCard, linkify
    ideas/capture-sheet.tsx     Bottom sheet for capturing new ideas
    ideas/flashback.tsx         "On this day" random past idea surfacer
    ui/aurora.tsx               Canvas wave animation (login page background)
    ui/glow-card.tsx            Mouse-follow glow effect on cards (desktop only, no-op on iPhone)
  lib/
    api.ts                      All fetch calls to /api/flask/*
    hooks/use-ideas.ts          SWR hook — ideas with optimistic add/remove/patch
    hooks/use-search.ts         Fuse.js client search + Flask semantic search
    biometric.ts                WebAuthn register/verify helpers
  proxy.ts                      Next.js middleware — cookie auth check
  public/sw.js                  Service worker — cache-first for /_next/static/* assets
```

## Data

- `notes.db` — SQLite, bind-mounted at `/home/ardi/Projects/think_tank/notes.db`. **Never delete. Never commit.**
- `uploads/` — media files, bind-mounted. Also never commit.
- Both are gitignored. If they appear in `git status`, run `git rm --cached notes.db`.

## SWR config

`revalidateOnFocus: false`, `revalidateOnReconnect: false`, `dedupingInterval: 10000` — set globally in `components/providers.tsx`. Ideas only refetch on: initial load, manual pull-to-refresh (`mutate()`), or after a write. Do not re-enable background revalidation — the data is single-user and writes go through optimistic updates.

## Service worker

`public/sw.js` — cache-first for `/_next/static/*` (content-hashed, safe to cache forever) and icons/manifest. HTML pages are never cached (auth middleware must run server-side). Registered in `layout.tsx` via inline script.

## API conventions

All browser→Flask calls go through the Next.js proxy at `/api/flask/*`. Never call Flask directly from the browser. The proxy strips auth and forwards method/body/content-type.

Flask runs on port 6000 internally. Direct access (iPhone Shortcuts, cron jobs) hits port 6000 on the host.

## Design principles

- **Speed first** — optimistic updates on every write, no loading spinners for captures
- **No friction at capture time** — don't add categories, tags, or structure
- **Nothing disappears** — ideas are permanent, no archive/dismiss/delete flows unless explicitly building a trash feature
- **Mobile-first** — designed for iPhone PWA, not desktop
- **Vancouver timezone** — all timestamps in `America/Vancouver`

## Performance notes (what's been done)

- BiometricGate: no artificial delay, no server round trip — sessionStorage local lock only
- SWR: background revalidation disabled — manual pull-to-refresh only
- Service worker: static JS/CSS cached on first load, served from disk after
- Password env var: read from `THINK_TANK_PASSWORD` in `.env` (was hardcoded "changeme" — now fixed)
- Next.js proxy body limit: `proxyClientMaxBodySize: "500mb"` in `next.config.ts` (Next.js 16 defaults to 10MB, which truncates video uploads)
- Daily summary: async fire-and-forget via daemon thread + client polling (Ollama on CPU takes 30-120s, exceeds gunicorn timeout if done synchronously)
- Summary card navigation: SWR cache pre-populated on click so recap detail page renders instantly

## Known tech debt / future work

See `docs/future-features.md` for planned features (soft delete/trash, activity heatmap stats).

- `GlowCard` adds mouse-only hover effects to every idea card — no-op on iPhone but adds DOM overhead
- No virtual list in feed — `react-window` is installed but unused; "All" tab renders every idea
- Images in idea cards not lazy-loaded (`loading="lazy"` missing)
- Flask proxy in Next.js adds a network hop — could be bypassed for API calls if needed
