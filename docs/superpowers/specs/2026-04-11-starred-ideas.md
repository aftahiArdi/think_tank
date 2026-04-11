# Starred Ideas — Design Spec

## Overview

Add the ability to star/favourite individual ideas. Starring is accessible from both the idea card in the feed and the idea detail page. Starred ideas get their own dedicated tab in the bottom nav.

---

## Data Layer

### SQLite migration

```sql
ALTER TABLE ideas ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
```

Run on app startup (safe to run repeatedly via `IF NOT EXISTS` check on column existence, or guarded with a try/except in Flask).

### Flask endpoint

**`PATCH /api/ideas/<int:idea_id>/star`**

Request body:
```json
{ "starred": true }
```

Response: full idea object (same shape as the existing `GET /ideas` items), with `starred` included.

Updates `starred` on the row, returns 200 with the updated idea. Returns 404 if idea not found.

### `GET /api/ideas` response change

Each idea object gains:
```json
{ "starred": true }
```

`starred` is a boolean (coerce from SQLite integer with `bool(row["starred"])`).

---

## Frontend

### `lib/types.ts`

Add `starred: boolean` to the `Idea` interface.

### `lib/api.ts`

```ts
export async function starIdea(id: number, starred: boolean): Promise<Idea> {
  const res = await fetch(`/api/flask/ideas/${id}/star`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starred }),
  });
  if (!res.ok) throw new Error("Failed to star idea");
  return res.json();
}
```

### `lib/hooks/use-ideas.ts`

Add `starIdea(id, starred)` method alongside existing `addIdea` / `removeIdea` / `patchIdea`.

- Optimistic update: immediately flip `starred` on the matching idea in the local SWR cache
- On server error: revert the cache and surface the error (same pattern as existing mutations)

```ts
async function starIdea(id: number, starred: boolean) {
  mutate(
    ideas => ideas?.map(i => i.id === id ? { ...i, starred } : i),
    false
  );
  try {
    await apiStarIdea(id, starred);
  } catch {
    mutate(); // revert
  }
}
```

---

## UI

### `IdeaCard` — star button

- Lucide `Star` icon, pinned to top-right corner of every card
- Filled + coloured (`#facc15`, yellow) when `idea.starred === true`; outline + muted when false
- Tap calls `starIdea(idea.id, !idea.starred)` and stops event propagation so the card doesn't open
- Button is `w-7 h-7`, positioned `absolute top-2 right-2`
- No label, no confirmation

### Idea detail page (`app/ideas/[id]/page.tsx`)

- Star toggle button added to the existing action row (alongside copy and delete)
- Same filled/outline visual as the card
- Calls the same `starIdea` from `use-ideas`

### Bottom nav

- `"starred"` added to `TabName` union: `"ideas" | "search" | "starred" | "categories"`
- Tab order: Ideas · Search · Starred · Settings
- Icon: `Bookmark` from lucide-react
- Label: "Starred"

### Starred tab content (`page.tsx`)

When `activeTab === "starred"`:

```tsx
const starredIdeas = ideas.filter(i => i.starred);
```

- Renders the same `IdeaCard` list as the feed (no new component needed)
- Sorted by timestamp descending (same as feed)
- No pull-to-refresh (it's a live client-side filter — updates instantly when you star/unstar elsewhere)
- Empty state: two lines of muted text — "No starred ideas yet." / "Tap the star on any idea to save it here."

---

## File Changelist

| File | Change |
|------|--------|
| `app.py` | Add `starred` column migration on startup; add `PATCH /api/ideas/<id>/star` endpoint; include `starred` in all idea serialisation |
| `frontend/lib/types.ts` | Add `starred: boolean` to `Idea` |
| `frontend/lib/api.ts` | Add `starIdea(id, starred)` |
| `frontend/lib/hooks/use-ideas.ts` | Add `starIdea` with optimistic update |
| `frontend/components/ideas/idea-card.tsx` | Add star button (top-right, absolute positioned) |
| `frontend/app/ideas/[id]/page.tsx` | Add star toggle to action row |
| `frontend/components/layout/bottom-nav.tsx` | Add `"starred"` tab with Bookmark icon |
| `frontend/app/page.tsx` | Handle `activeTab === "starred"`, render filtered list + empty state |

---

## Out of Scope

- Sorting or filtering the starred tab (it shows all starred ideas, newest first)
- Bulk-starring or starring from search results (can be added later)
- Starred count badge on the tab icon
