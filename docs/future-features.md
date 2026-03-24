# Future Features

## Trash / Soft Delete

**UX:** On an idea detail page, instead of permanently deleting, tapping the trash icon moves the idea to a "Trash" folder. A separate Trash view (accessible from settings or a dedicated tab) shows all trashed ideas. The user can:
- **Restore** individual ideas back to the feed
- **Delete permanently** individual ideas
- **Empty Trash** — wipes all trashed ideas at once (with confirmation), macOS-style

**Backend changes:**
- Add `trashed_at DATETIME` column to `ideas` table
- `DELETE /ideas/<id>` becomes a soft delete: sets `trashed_at = now()`
- New endpoints:
  - `GET /trash` — return ideas where `trashed_at IS NOT NULL`
  - `POST /trash/<id>/restore` — set `trashed_at = NULL`
  - `DELETE /trash/<id>` — hard delete single trashed idea
  - `DELETE /trash` — empty trash (hard delete all trashed)
- `GET /ideas` excludes `trashed_at IS NOT NULL` rows

**Frontend changes:**
- Idea detail page: trash icon → soft delete → navigate back
- Settings page or new "Trash" tab: list trashed ideas with restore + permanent delete
- "Empty Trash" button with destructive confirmation dialog
- Trashed ideas auto-expire after 30 days (cron job or on-read filter)

---

## My Stats — Idea Activity Grid

**UX:** A GitHub-style contribution heatmap in the Settings page showing idea capture frequency over the past year. Each cell = one day, color intensity = number of ideas that day. Fun, personal, motivating to keep a streak going.

**Visual design:**
- 52-column × 7-row grid (weeks × days), scrollable horizontally so the most recent week is always on the right
- Cells are small squares (~10px) with 2px gap, rounded corners
- Color scale: 0 ideas = `var(--muted)`, 1–2 = low intensity accent, 3–5 = mid, 6+ = full intensity (use the primary color with opacity steps)
- Tooltip / tap on a cell → shows the date + exact count ("5 ideas on March 22")
- Above the grid: headline stat like "🔥 12-day streak" or "✦ 347 ideas captured"
- Below: row of fun stats — longest streak, most ideas in a day, most active day of week, total this month

**Backend changes:**
- New endpoint `GET /stats/activity` — returns a map of `{ "YYYY-MM-DD": count }` for the past 365 days, queried with a single `GROUP BY date(timestamp)` on the ideas table

**Frontend changes:**
- `StatsGrid` component in settings tab — fetches `/api/flask/stats/activity` with SWR
- Builds the 52×7 grid from the date map, fills empty days with 0
- Streak calculation done client-side from the date map
- Animate cells in on mount with a staggered fade (each column slightly delayed)
