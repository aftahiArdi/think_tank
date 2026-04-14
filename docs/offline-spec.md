# Offline Spec — Think Tank PWA

**Goal:** the iPhone PWA works identically whether online, offline, or flaky — captures never fail, feed is always browsable, writes sync automatically when connectivity returns. No "you're offline" banners, no error toasts on flaky networks.

**Constraint:** only 3 users, single writer per account. Last-write-wins is acceptable; no conflict UI, no CRDTs.

## The simplest path: Workbox in the service worker

Instead of refactoring `use-ideas.ts`, `api.ts`, and every component to read from IndexedDB, do everything in `sw.js`. Components keep calling `/api/flask/*` via `fetch`; the service worker intercepts, serves from cache offline, and queues failed writes for replay. The React code doesn't change.

This works because:

- All browser → Flask traffic already goes through `/api/flask/*` (the Next.js proxy) — one interception surface.
- Optimistic UI already exists in `use-ideas.ts` — captures show instantly regardless of network.
- The Background Sync API replays queued writes when the SW regains network, transparently.
- Workbox ships prebuilt strategies for all of this; we write glue, not infrastructure.

## Architecture

```
iPhone PWA
  │
  ├── fetch("/api/flask/ideas")        ─┐
  │                                     │
  ├── fetch("/api/flask/ideas", POST)  ─┤
  │                                     │
  └── fetch("/api/flask/uploads/x.jpg") ─┤
                                         ▼
                               ┌──────────────────┐
                               │    sw.js         │
                               │   (Workbox)      │
                               └──────────────────┘
                                 │            │
                GET routes       │            │ POST/PATCH/DELETE
                                 ▼            ▼
                     ┌────────────────┐   ┌──────────────┐
                     │  Cache API     │   │  IDB outbox  │
                     │ (feed, media)  │   │ (queued      │
                     │                │   │  mutations)  │
                     └────────────────┘   └──────────────┘
                             │                     │
                             └────── network ──────┘
                                        ▼
                                    Flask API
```

Three routes, three strategies — that's the whole design.

## Route strategies

### 1. Feed reads — `/api/flask/ideas*` → StaleWhileRevalidate

Return the cached response immediately (so the UI paints from disk in <50ms), then fetch fresh in the background and update the cache. If offline, the cached response is the final answer.

Cache name: `tt-ideas-v1`. Max age: 30 days. Max entries: 50 (one per unique URL — page 1 + a handful of `before=` cursors).

Covered endpoints: `/ideas`, `/ideas/:id`, `/ideas/on-this-day`, `/ideas/starred`, `/ideas/stats-data`, `/ideas/random`.

### 2. Media — `/api/flask/uploads/*` → CacheFirst with LRU eviction

Check cache first, only hit network on miss. These URLs are content-addressed (filenames embed a hash), so they never change once fetched.

Cache name: `tt-media-v1`. Max entries: 300. Max size: 40 MB (leaves headroom under iOS's ~50 MB PWA quota).

On eviction, oldest entries go first. Users scrolling way back in history may see media load from network — acceptable.

### 3. Writes — POST/PATCH/DELETE → NetworkOnly + BackgroundSyncPlugin

Try the network. If it fails (offline, flaky, 5xx), enqueue the request in an IDB-backed queue and resolve the fetch with a synthetic `202 Accepted` so the React optimistic UI doesn't roll back.

When the browser's `sync` event fires (connectivity returns), Workbox replays the queue in order. Successful replays drop from the queue; persistent failures stay.

Covered endpoints: all mutations — `POST /ideas`, `PATCH /ideas/:id`, `DELETE /ideas/:id`, `PATCH /ideas/:id/star`, `POST /upload`, feed share/unshare, star/unstar.

Queue name: `tt-mutation-queue`. Max retention: 7 days (matches Background Sync's default).

## Server-side change: idempotency keys

Queued writes may replay multiple times across tabs or retries. To stop duplicates:

- Client generates a UUID per mutation, sends it in an `Idempotency-Key` header.
- Flask stores successful keys in a small `idempotency` table (key → response JSON, 48h TTL).
- Repeat requests with the same key return the stored response without re-executing.

One new table, one middleware function in `app.py`. Maybe 30 lines.

## Auth

The 30-day HMAC cookie already works offline — no change needed.

**The one gotcha:** Next.js middleware redirects uncached HTML to `/login`. Fix: precache `/` and `/ideas/[id]` as app shells in the SW, served with `NetworkFirst` so online opens still hit middleware. When offline, the cached shell serves and the client-side `BiometricGate` / `PasswordGate` handles the (cached) auth state.

## Captures offline

This is where "seamless" matters most. Today: tap +, type, hit save — optimistic UI shows the idea, a POST fires. If offline:

1. POST hits the SW, fails the network request, Workbox enqueues it, returns `202`.
2. `use-ideas.ts` sees success, keeps the optimistic row in place.
3. On reconnect, Workbox replays the POST. Flask creates the row with the idempotency key.
4. The next SWR revalidation (pull-to-refresh or app resume) replaces the optimistic row with the canonical one.

**One edge case:** media uploads. `FormData` isn't serializable to IDB — Workbox handles this via `RequestStore`, which clones the request body as a Blob. Confirmed working in Workbox v7+.

## What we deliberately skip

- **No IDB-as-source-of-truth refactor.** The Cache API stores full HTTP responses; SWR + localStorage already handle the JSON layer. Adding a third layer (IDB mirror) doubles the write paths for marginal gain.
- **No conflict resolution UI.** Single writer = last replay wins. If the same idea is edited on two devices while offline, the later sync overwrites. Acceptable.
- **No custom sync engine.** Workbox + Background Sync is battle-tested and ~40 lines of config.
- **No "you are offline" indicator.** Seamless means invisible. The only visible offline signal is media that hasn't been cached yet showing broken — rare if the user has opened the feed recently.

## Offline performance

The enemy is IO and DOM cost, not CPU.

- **Paint from Cache API, not IDB.** The Cache API returns a `Response` from disk synchronously; SWR keeps parsed data in memory after the first hit. Don't build a third JSON layer in IDB.
- **Keep the hot set small.** Precache only what renders on first paint: page 1 of `/ideas`, `/ideas/on-this-day`, `/ideas/starred`. Everything else lazy-loads on demand. Don't try to mirror all 900 ideas to the cache.
- **Thumbnails, not full-res.** Image decode is the real cold-start cost on iPhone, not the network. Add a thumbnail pipeline to Flask — resize on upload, store `<filename>-thumb.webp` alongside the original. Feed cards render thumbs from cache; detail view loads full-res on demand.
- **Virtualize the feed.** `react-window` is installed but unused. On the "All" tab with 863 cards, the DOM is the bottleneck regardless of network. Do this first — it's the biggest single offline-mode win and it doesn't require any SW work.
- **Budget the service worker.** Every `fetch` interception costs ~2ms. Scope the Workbox routes tightly: `/api/flask/*` only. Let the HTTP cache handle `/_next/static/*` — no SW involvement needed.
- **Heatmap and stats load once per session.** `/ideas/stats-data` returns 900 lightweight rows (~150 KB). Cache it with StaleWhileRevalidate and a 10-minute staleness window so the stats tab opens instantly from cache on subsequent visits.

## Sync reconciliation

The enemy is race conditions on reconnect.

- **Idempotency keys are non-negotiable.** Every queued mutation carries a client UUID in the `Idempotency-Key` header. Flask dedupes against a small table (key → response JSON, 48h TTL). Without this, a flaky connection that gets a 200 but drops the ACK creates duplicates on every replay.
- **Replay in order, one at a time.** Workbox's BackgroundSyncPlugin does this by default. Parallel replay races — e.g. "create idea A" + "star idea A" — because the star needs the server-assigned ID. Sequential + idempotent = correct.
- **Silent optimistic → canonical reconciliation.** When a queued POST replays, Flask returns the canonical row with its real ID. The SW posts a `mutations-synced` message to all open clients. `use-ideas.ts` catches it and calls `mutate()` on the affected SWR keys. The optimistic row swaps to canonical with no flicker — but only if React list keys are stable: use the client UUID as the key until reconciliation, then the server ID.
- **Revalidate after sync, not before.** The client doesn't poll and doesn't trigger sync — the browser's Background Sync API fires exactly once per connectivity change. UX is: phone reconnects → iOS wakes the SW → queue drains → clients revalidate. Invisible.
- **Clock skew handling.** The client shows optimistic rows stamped with its own `new Date()`. The server stamps canonically on create. When the replayed POST returns, the server timestamp may be a few seconds off, which could reorder the feed mid-view. Rule: if the delta is under 5 minutes, keep the client timestamp in the list ordering and only swap the ID. This keeps visible order stable across reconciliation.
- **Failed replays need a ceiling.** A mutation retrying for 24h is probably broken — bad media, deleted parent, schema drift. Drop from the queue after 24h and surface a toast: "1 capture couldn't sync — tap to retry". This is the *only* visible offline affordance, shown only when something actually broke.
- **Single-flight revalidation.** When the sync completes, revalidate each affected SWR key exactly once. SWR's `dedupingInterval: 10000` (already set) naturally prevents a queue of 20 mutations from triggering 20 refetches.

## Implementation order

1. **Add Workbox.** Install `workbox-webpack-plugin` or use the prebuilt `workbox-sw` bundle from CDN. Replace the hand-rolled `public/sw.js` with a Workbox-generated version.
2. **Route 1: feed reads (SWR).** Ship this alone — instant feed paint, free win, zero regression risk.
3. **Route 2: media (CacheFirst).** Ship this alone — feed scrolling works offline for recently-viewed history.
4. **Server: idempotency middleware + table.** Ship before route 3 so duplicate writes can't corrupt state.
5. **Route 3: writes (BackgroundSync).** Final piece — captures and edits work offline.
6. **App shell precache.** Enables offline cold-starts.

Each step is independently valuable and independently reversible. If step 5 turns out flaky, we keep 1–4 and the app is still 80% better.

## Effort

- Steps 1–2: half a day.
- Step 3: half a day (mostly testing on flaky network).
- Step 4: half a day (Flask middleware is simple, the test cases are not).
- Step 5: one day (the replay edge cases — duplicate tabs, clock skew, failed uploads).
- Step 6: half a day.

**Total: ~3 focused days.** Can ship 1–2 on day one.

## Success criteria

- Cold-start the PWA on airplane mode: feed loads, last 26 weeks of heatmap render, flashback card appears, search (fuzzy) works, stats tab loads.
- Capture a text idea on airplane mode: idea appears instantly, persists across app restart while still offline, syncs to server within 30s of reconnect.
- Capture an image idea on airplane mode: same, plus the image blob survives the queue.
- Edit an existing idea on airplane mode: change sticks, syncs on reconnect.
- Star/unstar an idea on airplane mode: state sticks, syncs on reconnect.
- Reconnect with 20 queued mutations: all replay in order, no duplicates, no lost writes.
- iOS storage pressure test: 500 cached media entries, no quota errors, LRU evicts oldest.
