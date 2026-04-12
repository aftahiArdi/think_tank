# Shared Feed & User Profiles — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared social feed where users can opt-in share individual idea cards, and allow users to set a profile picture — all with optimistic, instant-feeling interactions.

**Architecture:** Lightweight join table (`shared_feed`) keeps ideas private by default; sharing creates a pointer. Avatars stored as files in `uploads/avatars/`. New Feed tab in bottom nav. Settings dialog reorganised with profile at top and theme at bottom.

**Tech Stack:** Flask + SQLite (backend), Next.js App Router + SWR + TypeScript (frontend), existing shadcn/ui components, existing upload patterns.

---

## Database Changes

### `users` table
Add `avatar_filename TEXT` (nullable). No avatar = show coloured initials fallback.

```sql
ALTER TABLE users ADD COLUMN avatar_filename TEXT;
```

### New `shared_feed` table
```sql
CREATE TABLE IF NOT EXISTS shared_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shared_at DATETIME NOT NULL,
    UNIQUE(idea_id)
);
```

`UNIQUE(idea_id)` — each idea can only be shared once. Unsharing = DELETE row.

---

## Flask API Endpoints

### `GET /feed`
Returns all shared posts, reverse-chronological. Joins `shared_feed → ideas → users → idea_media`.

Response:
```json
{
  "posts": [
    {
      "id": 1,
      "idea_id": 42,
      "shared_at": "2026-04-12 10:30:00",
      "author": {
        "username": "aardi",
        "avatar_url": "/uploads/avatars/aardi.jpg"
      },
      "content": "idea text",
      "media": [
        { "id": 1, "media_type": "image", "url": "/api/flask/uploads/aardi/42_photo.jpg" }
      ],
      "is_mine": true
    }
  ]
}
```

`is_mine` is true when the post's `user_id` matches the requesting user — used to show the unshare control.

### `POST /feed/share/<idea_id>`
- Returns 403 if idea doesn't belong to the requesting user
- Returns 409 if already shared
- Inserts into `shared_feed`, returns `{ "id": <shared_feed_id> }`

### `DELETE /feed/share/<idea_id>`
- Returns 403 if idea doesn't belong to the requesting user
- Deletes row from `shared_feed`

### `POST /profile/avatar`
- Accepts `multipart/form-data` with a single `file` field (image only)
- Stores at `uploads/avatars/<username>.<ext>` (overwrites previous)
- Updates `users.avatar_filename`
- Returns `{ "avatar_url": "/api/flask/uploads/avatars/aardi.jpg" }`

### `GET /uploads/avatars/<filename>`
Served by existing Flask static-file route pattern (same as idea media).

### `GET /ideas/<id>` (existing, extend response)
Add `is_shared: boolean` to indicate whether this idea is currently in the shared feed. Used by the detail page to show "Shared ✓" vs "Share to feed" state.

---

## Frontend — New Files

### `frontend/lib/hooks/use-feed.ts`
SWR hook for the shared feed. Unlike `use-ideas`, this revalidates on focus (other users post here).

```typescript
export function useFeed() {
  const { data, isLoading, mutate } = useSWR("feed", fetchFeed, {
    revalidateOnFocus: true,
    dedupingInterval: 5000,
  });
  return { posts: data?.posts ?? [], isLoading, mutate };
}
```

### `frontend/lib/api.ts` (extend)
Add:
- `fetchFeed()` → `GET /api/flask/feed`
- `shareIdea(ideaId)` → `POST /api/flask/feed/share/<id>`
- `unshareIdea(ideaId)` → `DELETE /api/flask/feed/share/<id>`
- `uploadAvatar(file)` → `POST /api/flask/profile/avatar`

### `frontend/components/feed/feed-post-card.tsx`
Renders a single shared post. Props: `post: FeedPost, onUnshare?: () => void`.

Layout:
- Row: `<AvatarCircle>` (40px) + username (bold) + "· X time ago"
- Idea text (capped at 4 lines with CSS `-webkit-line-clamp`, full text on tap)
- Media: image thumbnails (tap → lightbox), 🎥 chip, 🎙️ chip
- If `post.is_mine`: a small "Remove from feed" text button at bottom-right

### `frontend/components/feed/avatar-circle.tsx`
Reusable avatar component. Props: `username: string, avatarUrl?: string, size?: number`.

- If `avatarUrl`: renders `<img>` (circular, object-cover)
- Else: coloured circle with initials. Colour derived deterministically from username (hash → HSL).

### `frontend/components/feed/feed-view.tsx`
The full feed tab content. Uses `useFeed()`. Pull-to-refresh. Empty state: "Nothing shared yet. Share an idea from your feed."

### `frontend/components/feed/share-confirm-sheet.tsx`
Bottom sheet shown when user taps "Share to feed". Shows idea content preview (truncated), the prompt "Is this worth sharing with everyone?", and **Share** / **Cancel** buttons.

---

## Frontend — Modified Files

### `frontend/components/layout/bottom-nav.tsx`
Add "Feed" tab. Tab order: Ideas | Search | **Feed** | Starred | Stats. The + button stays centred. Update `TabName` type.

### `frontend/components/home-client.tsx`
Add `activeTab === "feed"` → `<FeedView />`. Import and render `FeedView`.

### `frontend/app/ideas/[id]/page.tsx`
At the bottom of the idea detail page, when `idea` belongs to the current user (compare `idea.user_id` to current user from `think_tank_user` cookie):
- Show "Share to feed" button if `!idea.is_shared`
- Show "Shared ✓" button (with unshare on tap) if `idea.is_shared`

Both are optimistic: state updates instantly, API call in background.

To know the current user client-side, read `think_tank_user` cookie (already non-HttpOnly). The `Idea` type needs `user_id: number` and `is_shared: boolean` added.

### `frontend/lib/types.ts`
```typescript
// Extend Idea
interface Idea {
  // ... existing fields
  user_id: number;
  is_shared: boolean;
}

// New types
interface FeedPost {
  id: number;
  idea_id: number;
  shared_at: string;
  author: { username: string; avatar_url: string | null };
  content: string;
  media: IdeaMedia[];
  is_mine: boolean;
}
```

### `frontend/components/auth/biometric-toggle.tsx` → `frontend/components/settings/`
No code change, just moved to a settings directory for organisation. (Optional — skip if it causes friction.)

### `frontend/app/api/auth/route.ts` (no change needed)
Avatar URL will come from `/feed` and profile endpoints, not auth.

### `frontend/components/home-client.tsx` — Settings dialog
Reorganise the Settings `<Dialog>` content:

1. **Profile section** (top): `<AvatarCircle>` (64px, tappable) + username. Tap → hidden `<input type="file" accept="image/*">` → upload via `uploadAvatar()` → optimistic preview with `URL.createObjectURL`.
2. **Face ID toggle** (middle): unchanged
3. **Theme selector** (bottom): moved from Stats tab

### `frontend/components/theme/theme-selector.tsx`
No change to the component itself — just imported in Settings dialog instead of Stats tab.

### `frontend/components/stats/stats-view.tsx`
No change — stays in the Stats tab, but without the theme selector above it.

---

## Flask — `app.py` changes

1. Add `avatar_filename` migration in `init_db()`
2. Create `shared_feed` table in `init_db()`
3. Extend `GET /ideas` and `GET /ideas/<id>` responses to include `user_id` and `is_shared`
4. Implement `GET /feed`, `POST /feed/share/<id>`, `DELETE /feed/share/<id>`
5. Implement `POST /profile/avatar`
6. Serve `uploads/avatars/*` via existing static file route

---

## Performance Notes

- **Avatar upload**: `URL.createObjectURL(file)` shown immediately in the UI. Server URL replaces it after upload completes. No spinner during upload.
- **Share action**: optimistic — button state flips instantly, `POST` runs in background. On error, revert and show toast.
- **Feed revalidation**: `revalidateOnFocus: true` with 5s dedup so switching to the Feed tab fetches fresh posts from others without hammering the server.
- **Avatar cache**: browser caches avatar images. Since the file is overwritten at the same URL on update, we append `?v=<timestamp>` to the avatar URL returned by `POST /profile/avatar` to bust the cache on change.
- **`is_shared` on idea detail**: read from the idea object already in SWR cache — no extra network call.

---

## What Is Not Built

- No reactions or comments on feed posts
- No notifications when someone shares
- No following/follower model
- No feed post editing (share the idea, not a copy — edit the idea itself)
