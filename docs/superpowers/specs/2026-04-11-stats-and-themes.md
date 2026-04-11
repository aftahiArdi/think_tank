# Stats Page & Themes — Design Spec

## Overview

Two related changes to the settings tab:

1. **Stats page** — replace the CategoryManager with a rich stats view computed from the existing ideas array. No new API endpoints.
2. **New themes** — add 5 dark themes to `globals.css` and redesign the theme selector from text buttons to a swatch grid.

---

## Settings Tab Changes

### What's removed
- `CategoryManager` component hidden from the tab (categories still exist in the data model, just not surfaced in the UI for now)
- `ThemeSelector` removed from the settings **dialog** (it now only lives on the tab)

### Settings tab layout (top to bottom, scrollable)

```
ThemeSelector (swatch grid)
─────────────────────────────
Stats
  Hero total + since date
  3-column grid: streak · avg/day · active days
  Activity heatmap
  This week vs last week
  Total words captured
  Type breakdown
  Patterns grid
─────────────────────────────
BiometricToggle  ← stays here
```

### Settings dialog (gear icon in header)
Only contains: `BiometricToggle`. Theme selector moves to the tab exclusively.

---

## Stats Component

### Location
`frontend/components/stats/stats-view.tsx` — new component, rendered inside the categories tab in `page.tsx`.

### Data source
Receives `ideas: Idea[]` as a prop (already fetched by `useIdeas` in `page.tsx`). All calculations are pure client-side functions. No SWR calls, no API hits.

### Computed stats

| Stat | Calculation |
|------|-------------|
| Total ideas | `ideas.length` |
| Since date | `ideas[ideas.length - 1].timestamp` formatted as "Mon DD, YYYY" |
| Current streak | Walk backwards from today counting consecutive days with ≥1 idea |
| Longest streak | Walk all days, track max consecutive run |
| Avg per day | `total / daysSinceFirst` |
| Active days | Count unique dates in ideas |
| This week | Ideas where timestamp ≥ start of current week (Monday) |
| Last week | Ideas in the previous Mon–Sun window |
| Total words | `ideas.reduce((n, i) => n + i.content.trim().split(/\s+/).filter(Boolean).length, 0)` — skip empty content |
| Type counts | Group by `media_type`, compute count and percentage of total |
| Most active day of week | Group by `new Date(ts).getDay()`, find max |
| Peak hour | Group by `new Date(ts).getHours()`, find max, format as "H–H+1 AM/PM" |
| Best month | Group by "YYYY-MM", find max count, format as "Month YYYY · N ideas" |
| Activity heatmap | Build a map of `{ "YYYY-MM-DD": count }` for past 26 weeks (182 days) |

All date parsing uses Vancouver timezone: `new Date(ts + " UTC-8")` is not reliable — use the timestamp string directly (already stored in Vancouver time as "YYYY-MM-DD HH:MM:SS"). Parse the date portion with `.split(" ")[0]`.

### Sections

**Hero**
```
        847
   ideas captured
 since Jan 12, 2024
```
- Total in large bold, label below, date below that in muted colour

**3-column grid**
- Streak (green accent colour), avg/day, active days
- Streak value uses `--primary` or green from the theme's chart colours

**Activity heatmap**
- 26 columns × 7 rows = 182 days, newest column on the right
- Horizontally scrollable, auto-scrolls to rightmost column on mount (`ref.current.scrollLeft = ref.current.scrollWidth`)
- 4 intensity levels: 0 ideas, 1–2, 3–5, 6+
- Cell colours are fixed green regardless of theme (green = activity, universal): `#1e1e1e` (empty), `#14532d`, `#166534`, `#4ade80` (full)
- Legend: "less ··· more" in small text below

**This week vs last week**
- Single card: "17 this week" left, "+5 vs last week" badge (green if positive, muted if negative), "12 last week" right (muted)

**Total words captured**
- "47,312 words" large, subtitle: "About X novels worth of thought" (a novel ≈ 80,000 words)

**Type breakdown**
- List of Text · Photo · Sketch · Video
- Each row: label left, "count · pct%" right, progress bar below
- Bar colours: Text = green, Photo = blue, Sketch = purple, Video = orange (chart CSS vars)
- Skip types with 0 count

**Patterns grid** (2×2)
- Most active day (e.g. "Tuesday")
- Peak hour (e.g. "9–10 PM")
- Best month (e.g. "March" + "94 ideas" in muted)
- Longest streak (e.g. "34 days" + "Feb 2024" in muted)

### No emojis
None anywhere in the stats view.

---

## Theme Changes

### New themes added to `globals.css`

```
midnight      #0d1117 bg, #161b22 card, #30363d border, #e6edf3 fg
moonlight     #1e1e2e bg, #27273a card, #313244 border, #cdd6f4 fg, #cba6f7 primary
warm-charcoal #111110 bg, #1c1b1a card, #2a2926 border, #eeede9 fg
nord          #1a1e2e bg, #242938 card, #2e3347 border, #cdd6f4 fg, #89b4fa primary
forest        #0d1210 bg, #141d19 card, #1e2d28 border, #d4e8df fg, #4ade80 primary
```

Existing themes kept as-is: `minimal-dark`, `soft-neutral`, `glass-modern`.

All new themes must define the full set of CSS variables: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`.

### ThemeSelector redesign

**Old:** 3 text buttons in a flex row.

**New:** Swatch grid, 4 columns, wraps for 8 themes.

Each swatch:
```
┌─────────────┐
│  ■ ■ ■      │  ← 3 colour chips: bg, card, primary
│  Theme Name │
└─────────────┘
```
- Active theme: border uses `--foreground`, checkmark visible
- Inactive: border uses `--border`
- Tap to apply immediately (same as current behaviour)

**ThemeName type** in `lib/types.ts` must be extended with all 5 new names.

---

## File Changelist

| File | Change |
|------|--------|
| `frontend/app/globals.css` | Add 5 new theme blocks |
| `frontend/lib/types.ts` | Add 5 new names to `ThemeName` union |
| `frontend/components/theme/theme-selector.tsx` | Rewrite to swatch grid |
| `frontend/components/stats/stats-view.tsx` | New file — full stats component |
| `frontend/app/page.tsx` | Categories tab: remove CategoryManager, add StatsView; settings dialog: remove ThemeSelector |

---

## Out of Scope

- CategoryManager is hidden, not deleted — categories still work in the data model
- "Ideas never revisited" stat deferred — requires backend change (last-viewed timestamp)
- No new Flask API endpoints
- No changes to the ideas feed, capture sheet, or search tab
