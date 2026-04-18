# Mood Tracking — Design Spec

**Date:** 2026-04-18
**Status:** Approved — ready for implementation plan

## Overview

Add standalone mood check-ins to Think Tank. A user taps a button in the header, drags a 7-stop slider to indicate how they're feeling, and the value is saved with a timestamp. Moods are independent from ideas — they are their own data stream. The stats view gains a mood line graph and an average mood label.

The feature must not slow down any existing flow (feed, capture, search).

## Goals

- Log a mood in under 3 seconds from anywhere in the app.
- Keep mood data fully decoupled from ideas so the feed and capture flows are untouched.
- Visualize mood over time in the existing stats section.
- Leave the door open for future extensions (descriptors, causes, idea linkage) without schema changes.

## Non-Goals

- No descriptor chips (Joyful, Calm, etc.) in this version — slider only.
- No cause tagging (Work, Family, etc.) in this version.
- No association between moods and ideas in this version.
- No notifications or reminders.
- No mood indicators on idea cards — moods live in the stats view only.

## User Flow

1. User taps a mood icon in the header (top right, left of the Stats button).
2. A bottom sheet slides up containing only a horizontal gradient slider with 7 discrete stops, labeled Very Unpleasant → Neutral → Very Pleasant.
3. User drags the slider to the desired position. The thumb snaps to the nearest stop.
4. User taps "Done" (or taps outside). The mood is saved with the current timestamp. The sheet closes.
5. The next time the user opens the stats view, the new mood appears in the graph and contributes to the average.

## Data Model

New table in `notes.db`:

```sql
CREATE TABLE IF NOT EXISTS moods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mood_value INTEGER NOT NULL,
    timestamp DATETIME NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 1,
    label TEXT,
    cause TEXT,
    idea_id INTEGER REFERENCES ideas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_moods_user_timestamp ON moods(user_id, timestamp DESC);
```

Created in `init_db()` in `app.py` with `CREATE TABLE IF NOT EXISTS` — the same pattern used for every other table in this project.

### Mood value mapping

| Value | Label |
|-------|-------|
| 1 | Very Unpleasant |
| 2 | Unpleasant |
| 3 | Slightly Unpleasant |
| 4 | Neutral |
| 5 | Slightly Pleasant |
| 6 | Pleasant |
| 7 | Very Pleasant |

This mapping is the single source of truth. It lives in `frontend/lib/mood.ts` as a constant array and is re-declared in `app.py` where the backend needs it (for the `average_label` response field). The colors used in the gradient (purple → blue → orange) also live in `frontend/lib/mood.ts`.

### Why the nullable columns exist

The `label`, `cause`, and `idea_id` columns are intentionally included now, stored as NULL, and never read in this version. They exist so future Claude sessions can add features without a schema migration:

- **`label`** — future: populate with a short descriptor string (e.g., "Excited", "Stressed") when a chip-picker step is added to the mood sheet.
- **`cause`** — future: populate with a single-string cause tag (e.g., "Work", "Family") when the cause step is added.
- **`idea_id`** — future: populate when a mood is logged in the context of an idea (e.g., from within the capture flow or via automatic timestamp-proximity matching).

The `ON DELETE SET NULL` on `idea_id` ensures mood history survives idea deletion.

## API

All endpoints live in `app.py` and are served at `/moods` / `/moods/:id`. The browser accesses them via the existing `/api/flask/moods` proxy. No new auth logic.

### `POST /moods`

Log a new mood.

**Request:**
```json
{ "mood_value": 5 }
```

**Validation:** `mood_value` must be an integer in `[1, 7]`. Reject with 400 otherwise.

**Response (201):**
```json
{
  "id": 42,
  "mood_value": 5,
  "timestamp": "2026-04-18 14:23:00",
  "label": null,
  "cause": null,
  "idea_id": null
}
```

Timestamp is generated server-side in `America/Vancouver`.

### `GET /moods?days=30`

Fetch mood history for the graph and compute the average.

**Query params:**
- `days` — integer, defaults to 30. Returns moods from the last `days` days.

**Response (200):**
```json
{
  "moods": [
    {
      "id": 42,
      "mood_value": 5,
      "timestamp": "2026-04-18 14:23:00",
      "label": null,
      "cause": null,
      "idea_id": null
    }
  ],
  "average": 4.7,
  "average_label": "Slightly Pleasant"
}
```

`average` is `null` and `average_label` is `null` when there are no moods in the range.

### `DELETE /moods/:id`

Delete a mood entry. Used when the user long-presses a point on the graph to remove a mistaken log.

**Response (200):** `{ "ok": true }`

## Frontend Components

### New files

- **`frontend/lib/mood.ts`** — single source of truth for mood labels, colors, and the value→label map. Exports `MOOD_LABELS`, `MOOD_COLORS`, `labelForValue(n)`, `colorForValue(n)`.
- **`frontend/lib/api.ts`** (additions) — `logMood(mood_value)`, `fetchMoods(days)`, `deleteMood(id)`.
- **`frontend/components/mood/mood-button.tsx`** — icon button that opens the mood sheet. Smiley face icon from lucide.
- **`frontend/components/mood/mood-sheet.tsx`** — bottom sheet with the 7-stop gradient slider and Done button. Mirrors the style of `CaptureSheet` (same backdrop, same drag handle, same rounded top).
- **`frontend/components/mood/mood-slider.tsx`** — the slider control itself. Uses a native `<input type="range" min="1" max="7" step="1">` styled with the gradient as the track and a custom thumb. `input type="range"` gets free touch handling, keyboard support, and snapping.
- **`frontend/components/mood/mood-graph.tsx`** — SVG line graph for the stats view. No chart library. Inline SVG with a linear gradient stroke and background zone bands.
- **`frontend/components/mood/mood-average.tsx`** — small text block: "This week: Slightly Pleasant".
- **`frontend/lib/hooks/use-moods.ts`** — SWR hook that fetches and caches mood data for the stats view.

### Modified files

- **`frontend/components/layout/header.tsx`** — add a `MoodButton` to the left of the existing Stats button. Passes an `onMoodClick` prop down like the existing Stats/Settings buttons.
- **`frontend/components/home-client.tsx`** — add `moodOpen` state, render `<MoodSheet open={moodOpen} onOpenChange={setMoodOpen} />`, wire `onMoodClick={() => setMoodOpen(true)}` into `<Header>`.
- **`frontend/components/stats/stats-view.tsx`** — add a new section above or below the existing stats, containing `<MoodAverage>` and `<MoodGraph>`.
- **`frontend/lib/types.ts`** — add `Mood` and `MoodResponse` types.

### UI details

**Mood sheet:**
- Full-width sheet, short height (about 180px including handle and padding).
- Inside: title "How are you feeling?", the slider, the three labels (Very Unpleasant / Neutral / Very Pleasant), a Done button.
- Slider track is a 7-step gradient: `#7c3aed → #6366f1 → #818cf8 → #3b82f6 → #60a5fa → #f59e0b → #f97316`.
- Default thumb position: step 4 (Neutral).

**Mood graph (stats view):**
- SVG. X-axis is time (last 30 days), Y-axis is mood value 1-7.
- Line colored with a vertical linear gradient (purple at bottom, orange at top).
- Seven faint horizontal background bands, each in the color of its mood zone.
- Each data point is a small circle filled with its mood color.
- If fewer than two points exist, show the points only, no connecting line.
- Long-press on a point opens a small confirm dialog: "Delete this mood?"

**Mood average:**
- Plain text: "Last 30 days: Slightly Pleasant". The time window matches the graph's `days=30`.
- Small colored dot before the text, filled with the color of the rounded average value.

## Performance

This feature must not degrade existing performance. Specifics:

- **Ideas table untouched.** No schema change to `ideas`, no new joins, no new columns. Every existing query for `/ideas`, `/ideas/:id`, search, flashback, starred, etc., is identical.
- **Header button adds one icon.** No data fetch on app load — the mood sheet fetches nothing; the stats view is the only place moods are read.
- **Stats view lazy-loads.** The existing stats view is already opened on demand, not on app load. Adding a mood fetch there keeps cold-start cost unchanged.
- **No chart library.** Inline SVG only. Zero bundle cost.
- **Slider is a native `<input type="range">`.** No custom pointer-handling JS. Browser handles touch, snapping, accessibility for free.
- **Fire-and-forget write.** The `POST /moods` call is optimistic — the sheet closes immediately, the request flies in the background. SWR cache for the stats view is invalidated on success. If the write fails, a toast shows the error; the sheet does not block on the response.
- **Indexed query.** The `idx_moods_user_timestamp` index makes the `GET /moods?days=30` query O(log n) even with years of data.

## Failure Modes

- **Network failure on save** — toast error, mood is lost (not persisted locally). Acceptable because mood entries are low-stakes and duplicates are worse than misses.
- **Network failure on fetch in stats view** — SWR shows the last-cached data if any, otherwise a "couldn't load mood history" message. The rest of the stats view is unaffected.
- **Malformed `mood_value` in POST** — 400 with `{ "error": "mood_value must be an integer 1-7" }`.
- **Deleting a mood that doesn't exist** — 404, frontend toast "Already deleted".

## Testing

- **Backend:** add a small test block to the existing test setup (if one exists) covering the three endpoints: valid POST, out-of-range POST, GET with no moods, GET with moods, DELETE.
- **Frontend:** no automated tests — Think Tank's frontend currently has no test suite. Manual verification:
  - Tap mood button, drag slider, tap Done → mood appears in stats after reopening stats.
  - Tap mood button, drag slider, tap outside → sheet closes without saving.
  - Open stats with 0 moods → no graph, "no mood data yet" placeholder.
  - Open stats with many moods → graph renders, average shows correct label.
  - Feed, search, capture still load at the same speed (spot-check).

## Future Extensions

This section exists so future Claude sessions can extend this feature confidently. Read this before adding anything mood-related.

### Already prepared (no schema change needed)

The `moods` table has three NULL columns ready for these:

**1. Descriptor labels (`label` column)**

Add a chip picker after the slider step in the mood sheet. Pass the selected descriptor in the POST body:

```json
{ "mood_value": 5, "label": "Excited" }
```

Update the POST validator to accept an optional `label` string (max length ~32). Populate the `label` field in the response and in the GET response. Display on the graph tooltip.

Suggested descriptors per zone (inherited from Apple's State of Mind):
- Unpleasant zones: Angry, Sad, Drained, Stressed, Anxious
- Neutral zones: Indifferent, Content, Peaceful
- Pleasant zones: Amazed, Joyful, Calm, Grateful, Excited

**2. Cause tagging (`cause` column)**

Add a cause chip picker. Suggested causes: Work, Family, Partner, Friends, Health, Fitness, Money, Weather, Sleep. Same extension pattern as descriptors — accept an optional `cause` string in POST.

**3. Idea linkage (`idea_id` column)**

Two ways this can be lit up:

- **Capture-time linkage:** add a mood slider inside the capture sheet (collapsed by default). When present, the mood is saved with `idea_id` set to the newly created idea.
- **Auto-association:** on idea creation, look back ~30 minutes for the most recent standalone mood log with `idea_id IS NULL`. If one exists, set its `idea_id` to the new idea.

Once `idea_id` is populated, the idea detail page can show "Feeling: Pleasant" in the meta row by joining `moods` on `idea_id`.

### Likely future additions (may need schema changes)

**Streaks and weekly stats:** computed fields on the GET response. No schema change — just SQL aggregates on the mood history.

**Activity overlay on the graph:** faintly plot idea count per day behind the mood line. Requires a small change to `/moods` to join against the ideas table for counts per day, or a separate endpoint.

**Soft delete:** if deleting moods becomes risky, add a `deleted_at` column and filter. Not needed yet because the delete flow is opt-in (long-press confirm).

### Guardrails for future extensions

- **Never add mood columns to the `ideas` table.** The separation is intentional — it's what keeps the feed fast.
- **Preserve the `/api/flask/*` proxy pattern.** Don't call Flask directly from the browser.
- **Keep the slider as the primary capture mechanism.** Descriptors and causes are additive, not required.
- **Respect the performance constraint.** Any new query on load (header, feed, search) is a regression. New data fetches belong inside the stats view or similar lazy-loaded surfaces.

## File Touch List (summary)

**Backend:**
- `app.py` — add table, add 3 endpoints.

**Frontend (new):**
- `frontend/lib/mood.ts`
- `frontend/lib/hooks/use-moods.ts`
- `frontend/components/mood/mood-button.tsx`
- `frontend/components/mood/mood-sheet.tsx`
- `frontend/components/mood/mood-slider.tsx`
- `frontend/components/mood/mood-graph.tsx`
- `frontend/components/mood/mood-average.tsx`

**Frontend (modified):**
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`
- `frontend/components/layout/header.tsx`
- `frontend/components/home-client.tsx`
- `frontend/components/stats/stats-view.tsx`

**Docs:**
- `docs/superpowers/specs/2026-04-18-mood-tracking-design.md` (this file)

## Out of Scope (do not build in this pass)

- Mood descriptors (labels)
- Mood causes
- Idea-mood association
- Mood on idea cards
- Mood in the daily email digest
- Mood heatmap grid (GitHub-style) — user picked the line graph
- Activity overlay on the graph
- Mood reminders or notifications
- Mood editing (only delete via long-press)
