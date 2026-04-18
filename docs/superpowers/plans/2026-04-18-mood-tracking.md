# Mood Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add standalone mood check-ins (7-stop slider) with a line-graph visualization and average label in the stats view. Mood data lives in its own table — ideas table is untouched so existing flows keep their performance.

**Architecture:** New `moods` table with nullable placeholder columns (`label`, `cause`, `idea_id`) for future extensions. Three Flask endpoints (`POST /moods`, `GET /moods`, `DELETE /moods/:id`) served via the existing `/api/flask/*` Next.js proxy. Frontend adds a header button, a bottom sheet with a native `<input type="range">`-based slider, and two components in the stats view (graph + average label).

**Tech Stack:** Flask + SQLite (backend), Next.js 16 + React 19 + TypeScript + Tailwind + SWR (frontend). No chart library — inline SVG. No new npm packages.

**Spec reference:** `docs/superpowers/specs/2026-04-18-mood-tracking-design.md`

**Testing approach:** This project has no test framework. Backend verification is done via `curl` against the running Flask container. Frontend verification is done in the iPhone PWA / desktop browser. Each task includes explicit verification commands.

---

## Task 1: Create the `moods` table and migration hook

**Files:**
- Modify: `app.py` (inside `init_db()`, after the existing `feed_stars` table block near line 111)

- [ ] **Step 1: Add the table creation to `init_db()`**

In `app.py`, find the line that ends the `feed_stars` CREATE TABLE block (around line 111 — the `)''')` that closes `CREATE TABLE IF NOT EXISTS feed_stars`). Immediately after that block, before the `# Migrate ideas table: add columns if missing` comment, insert:

```python
    # Mood check-ins — standalone from ideas. Nullable columns are intentional
    # placeholders for future extensions (descriptors, causes, idea linkage).
    # See docs/superpowers/specs/2026-04-18-mood-tracking-design.md.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS moods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mood_value INTEGER NOT NULL,
            timestamp DATETIME NOT NULL,
            user_id INTEGER NOT NULL DEFAULT 1,
            label TEXT,
            cause TEXT,
            idea_id INTEGER REFERENCES ideas(id) ON DELETE SET NULL
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_moods_user_timestamp
        ON moods(user_id, timestamp DESC)
    ''')
```

- [ ] **Step 2: Rebuild and restart the Flask container**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache flask && docker compose up -d --force-recreate flask
```

- [ ] **Step 3: Verify the table exists**

Run:
```bash
docker exec think_tank_api sqlite3 /app/notes.db ".schema moods"
```

Expected output: the `CREATE TABLE moods` statement with all 7 columns plus the index.

- [ ] **Step 4: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add app.py
git commit -m "feat(mood): add moods table with extensibility placeholders"
```

---

## Task 2: Add `POST /moods` endpoint

**Files:**
- Modify: `app.py` (add a new route; place it near other POST routes, e.g., after the `POST /ideas` route around line 883)

- [ ] **Step 1: Add the endpoint**

In `app.py`, immediately after the existing `@app.route('/ideas', methods=['POST'])` handler (after the `return jsonify({'id': idea_id, 'message': 'Idea saved.'}), 201` and the closing except block around line 883), insert:

```python
# Mood value → label mapping. Keep in sync with frontend/lib/mood.ts MOOD_LABELS.
MOOD_LABELS = {
    1: "Very Unpleasant",
    2: "Unpleasant",
    3: "Slightly Unpleasant",
    4: "Neutral",
    5: "Slightly Pleasant",
    6: "Pleasant",
    7: "Very Pleasant",
}


@app.route('/moods', methods=['POST'])
def create_mood():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    mood_value = data.get('mood_value')
    if not isinstance(mood_value, int) or mood_value < 1 or mood_value > 7:
        return jsonify({'error': 'mood_value must be an integer 1-7'}), 400

    try:
        conn = get_conn()
        cursor = conn.cursor()
        vancouver_time = datetime.now(VANCOUVER_TZ).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            'INSERT INTO moods (mood_value, timestamp, user_id) VALUES (?, ?, ?)',
            (mood_value, vancouver_time, user_id)
        )
        mood_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return jsonify({
            'id': mood_id,
            'mood_value': mood_value,
            'timestamp': vancouver_time,
            'label': None,
            'cause': None,
            'idea_id': None,
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Rebuild and restart Flask**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache flask && docker compose up -d --force-recreate flask
```

- [ ] **Step 3: Verify with curl — valid POST**

Get the username from the `.env` first if needed; use the existing user. Replace `ardi` with the actual username if it differs:

```bash
curl -s -X POST http://localhost:6000/moods \
  -H "Content-Type: application/json" \
  -H "X-Think-Tank-User: ardi" \
  -d '{"mood_value": 5}'
```

Expected: JSON response with `"id"`, `"mood_value": 5`, a timestamp, and `"label": null`, `"cause": null`, `"idea_id": null`. HTTP 201.

- [ ] **Step 4: Verify with curl — invalid POST**

Run:
```bash
curl -s -X POST http://localhost:6000/moods \
  -H "Content-Type: application/json" \
  -H "X-Think-Tank-User: ardi" \
  -d '{"mood_value": 99}'
```

Expected: `{"error": "mood_value must be an integer 1-7"}`, HTTP 400.

Also test:
```bash
curl -s -X POST http://localhost:6000/moods \
  -H "Content-Type: application/json" \
  -H "X-Think-Tank-User: ardi" \
  -d '{}'
```

Expected: same 400 error.

- [ ] **Step 5: Verify unauthorized**

Run:
```bash
curl -s -w "%{http_code}" -X POST http://localhost:6000/moods \
  -H "Content-Type: application/json" \
  -d '{"mood_value": 5}'
```

Expected: `{"error": "Unauthorized"}401` at the end.

- [ ] **Step 6: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add app.py
git commit -m "feat(mood): add POST /moods endpoint"
```

---

## Task 3: Add `GET /moods` endpoint

**Files:**
- Modify: `app.py` (add after the `POST /moods` handler from Task 2)

- [ ] **Step 1: Add the endpoint**

In `app.py`, immediately after the `POST /moods` handler added in Task 2, insert:

```python
@app.route('/moods', methods=['GET'])
def list_moods():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        days = int(request.args.get('days', 30))
    except (TypeError, ValueError):
        days = 30
    if days < 1:
        days = 1
    if days > 3650:
        days = 3650

    try:
        conn = get_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT id, mood_value, timestamp, label, cause, idea_id
               FROM moods
               WHERE user_id = ?
                 AND timestamp >= datetime('now', 'localtime', ?)
               ORDER BY timestamp ASC''',
            (user_id, f'-{days} days')
        )
        rows = cursor.fetchall()
        conn.close()

        moods = [
            {
                'id': r['id'],
                'mood_value': r['mood_value'],
                'timestamp': r['timestamp'],
                'label': r['label'],
                'cause': r['cause'],
                'idea_id': r['idea_id'],
            }
            for r in rows
        ]

        if moods:
            avg = sum(m['mood_value'] for m in moods) / len(moods)
            rounded = max(1, min(7, round(avg)))
            average = round(avg, 2)
            average_label = MOOD_LABELS[rounded]
        else:
            average = None
            average_label = None

        return jsonify({
            'moods': moods,
            'average': average,
            'average_label': average_label,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

Note: the SQL uses `datetime('now', 'localtime', ?)` so the cutoff is computed in the server's local timezone. The Docker container runs UTC by default, but the stored timestamps are in Vancouver time — so the 30-day window is computed against raw strings and sorted lexicographically in ASCII, which matches chronological order for the `YYYY-MM-DD HH:MM:SS` format. If the window math turns out to be off by timezone offset, that's acceptable — the graph spans ~30 days either way.

- [ ] **Step 2: Rebuild and restart Flask**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache flask && docker compose up -d --force-recreate flask
```

- [ ] **Step 3: Verify with curl — with moods**

Run:
```bash
curl -s http://localhost:6000/moods?days=30 \
  -H "X-Think-Tank-User: ardi" | python3 -m json.tool
```

Expected: JSON with `"moods"` array (containing at least the mood created in Task 2), non-null `"average"` number, and non-null `"average_label"` string.

- [ ] **Step 4: Verify with curl — empty range**

Run:
```bash
curl -s "http://localhost:6000/moods?days=0" \
  -H "X-Think-Tank-User: ardi" | python3 -m json.tool
```

Expected: `"moods": []`, `"average": null`, `"average_label": null`.

- [ ] **Step 5: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add app.py
git commit -m "feat(mood): add GET /moods endpoint with average"
```

---

## Task 4: Add `DELETE /moods/:id` endpoint

**Files:**
- Modify: `app.py` (add after the `GET /moods` handler from Task 3)

- [ ] **Step 1: Add the endpoint**

In `app.py`, immediately after the `GET /moods` handler added in Task 3, insert:

```python
@app.route('/moods/<int:mood_id>', methods=['DELETE'])
def delete_mood(mood_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            'DELETE FROM moods WHERE id = ? AND user_id = ?',
            (mood_id, user_id)
        )
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        if deleted == 0:
            return jsonify({'error': 'Mood not found'}), 404
        return jsonify({'ok': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 2: Rebuild and restart Flask**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache flask && docker compose up -d --force-recreate flask
```

- [ ] **Step 3: Verify delete existing**

First, get a mood ID from the GET endpoint:
```bash
curl -s http://localhost:6000/moods?days=30 \
  -H "X-Think-Tank-User: ardi" | python3 -m json.tool
```

Then delete one (replace `1` with a real ID from the response):
```bash
curl -s -X DELETE http://localhost:6000/moods/1 \
  -H "X-Think-Tank-User: ardi"
```

Expected: `{"ok": true}`.

- [ ] **Step 4: Verify delete non-existent**

Run:
```bash
curl -s -w "%{http_code}" -X DELETE http://localhost:6000/moods/99999 \
  -H "X-Think-Tank-User: ardi"
```

Expected: `{"error": "Mood not found"}404` at the end.

- [ ] **Step 5: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add app.py
git commit -m "feat(mood): add DELETE /moods/:id endpoint"
```

---

## Task 5: Frontend — mood constants (`frontend/lib/mood.ts`)

**Files:**
- Create: `frontend/lib/mood.ts`

- [ ] **Step 1: Create the file**

Write `frontend/lib/mood.ts` with:

```typescript
// Source of truth for mood labels and colors. Keep MOOD_LABELS in sync with
// MOOD_LABELS dict in app.py. See docs/superpowers/specs/2026-04-18-mood-tracking-design.md.

export type MoodValue = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MOOD_LABELS: Record<MoodValue, string> = {
  1: "Very Unpleasant",
  2: "Unpleasant",
  3: "Slightly Unpleasant",
  4: "Neutral",
  5: "Slightly Pleasant",
  6: "Pleasant",
  7: "Very Pleasant",
};

// Colors for the gradient slider track and the graph. Index 0 = value 1, etc.
export const MOOD_COLORS: Record<MoodValue, string> = {
  1: "#7c3aed",
  2: "#6366f1",
  3: "#818cf8",
  4: "#3b82f6",
  5: "#60a5fa",
  6: "#f59e0b",
  7: "#f97316",
};

// CSS linear-gradient string used by the slider track (left to right = 1 to 7).
export const MOOD_GRADIENT = `linear-gradient(90deg, ${MOOD_COLORS[1]}, ${MOOD_COLORS[2]}, ${MOOD_COLORS[3]}, ${MOOD_COLORS[4]}, ${MOOD_COLORS[5]}, ${MOOD_COLORS[6]}, ${MOOD_COLORS[7]})`;

export function labelForValue(v: number): string {
  const clamped = Math.max(1, Math.min(7, Math.round(v))) as MoodValue;
  return MOOD_LABELS[clamped];
}

export function colorForValue(v: number): string {
  const clamped = Math.max(1, Math.min(7, Math.round(v))) as MoodValue;
  return MOOD_COLORS[clamped];
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/lib/mood.ts
git commit -m "feat(mood): add mood constants module"
```

---

## Task 6: Frontend — TypeScript types

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Add Mood types**

Open `frontend/lib/types.ts` and append these exports to the end of the file:

```typescript
export interface Mood {
  id: number;
  mood_value: number;
  timestamp: string;
  label: string | null;
  cause: string | null;
  idea_id: number | null;
}

export interface MoodHistory {
  moods: Mood[];
  average: number | null;
  average_label: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/lib/types.ts
git commit -m "feat(mood): add Mood and MoodHistory types"
```

---

## Task 7: Frontend — API client helpers

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add the three helpers**

Open `frontend/lib/api.ts` and append these exports to the end of the file:

```typescript
export async function logMood(mood_value: number) {
  const res = await fetch(`${API_BASE}/moods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mood_value }),
  });
  return handleResponse<import("./types").Mood>(res);
}

export async function fetchMoods(days: number = 30) {
  const res = await fetch(`${API_BASE}/moods?days=${days}`);
  return handleResponse<import("./types").MoodHistory>(res);
}

export async function deleteMood(id: number) {
  const res = await fetch(`${API_BASE}/moods/${id}`, { method: "DELETE" });
  return handleResponse<{ ok: true }>(res);
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/lib/api.ts
git commit -m "feat(mood): add mood API client helpers"
```

---

## Task 8: Frontend — `useMoods` SWR hook

**Files:**
- Create: `frontend/lib/hooks/use-moods.ts`

- [ ] **Step 1: Create the hook**

Write `frontend/lib/hooks/use-moods.ts` with:

```typescript
"use client";

import useSWR from "swr";
import { fetchMoods, logMood as logMoodApi, deleteMood as deleteMoodApi } from "@/lib/api";
import type { MoodHistory } from "@/lib/types";

const CACHE_KEY = (days: number) => `moods-${days}`;

export function useMoods(days: number = 30) {
  const { data, isLoading, mutate } = useSWR<MoodHistory>(
    CACHE_KEY(days),
    () => fetchMoods(days),
  );

  async function logMood(value: number) {
    const mood = await logMoodApi(value);
    await mutate();
    return mood;
  }

  async function removeMood(id: number) {
    await deleteMoodApi(id);
    await mutate();
  }

  return {
    data,
    isLoading,
    logMood,
    removeMood,
    refresh: mutate,
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/lib/hooks/use-moods.ts
git commit -m "feat(mood): add useMoods SWR hook"
```

---

## Task 9: Frontend — `MoodSlider` component

**Files:**
- Create: `frontend/components/mood/mood-slider.tsx`

- [ ] **Step 1: Create the directory and file**

Create the `frontend/components/mood` directory by writing the file:

Write `frontend/components/mood/mood-slider.tsx` with:

```typescript
"use client";

import { MOOD_GRADIENT, labelForValue, type MoodValue } from "@/lib/mood";

interface MoodSliderProps {
  value: MoodValue;
  onChange: (value: MoodValue) => void;
}

export function MoodSlider({ value, onChange }: MoodSliderProps) {
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          position: "relative",
          height: 44,
          borderRadius: 22,
          background: MOOD_GRADIENT,
          padding: "0 6px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <input
          type="range"
          min={1}
          max={7}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) as MoodValue)}
          aria-label="Mood level"
          style={{
            width: "100%",
            WebkitAppearance: "none",
            appearance: "none",
            background: "transparent",
            outline: "none",
            margin: 0,
          }}
          className="mood-range-input"
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--muted-foreground)",
          marginTop: 10,
        }}
      >
        <span>Very Unpleasant</span>
        <span>Neutral</span>
        <span>Very Pleasant</span>
      </div>

      <div
        style={{
          textAlign: "center",
          marginTop: 14,
          fontSize: 15,
          fontWeight: 600,
          color: "var(--foreground)",
        }}
      >
        {labelForValue(value)}
      </div>

      <style jsx>{`
        .mood-range-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          cursor: pointer;
          border: none;
        }
        .mood-range-input::-moz-range-thumb {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          cursor: pointer;
          border: none;
        }
        .mood-range-input::-webkit-slider-runnable-track {
          background: transparent;
          height: 44px;
        }
        .mood-range-input::-moz-range-track {
          background: transparent;
          height: 44px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/mood/mood-slider.tsx
git commit -m "feat(mood): add MoodSlider component"
```

---

## Task 10: Frontend — `MoodSheet` component

**Files:**
- Create: `frontend/components/mood/mood-sheet.tsx`

- [ ] **Step 1: Create the file**

Write `frontend/components/mood/mood-sheet.tsx` with:

```typescript
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { MoodSlider } from "@/components/mood/mood-slider";
import { useMoods } from "@/lib/hooks/use-moods";
import { haptics } from "@/lib/haptics";
import type { MoodValue } from "@/lib/mood";

interface MoodSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoodSheet({ open, onOpenChange }: MoodSheetProps) {
  const [value, setValue] = useState<MoodValue>(4);
  const [saving, setSaving] = useState(false);
  const { logMood } = useMoods();

  // Reset to neutral each time the sheet opens so state doesn't persist.
  useEffect(() => {
    if (open) setValue(4);
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  async function handleDone() {
    if (saving) return;
    setSaving(true);
    haptics.success();
    // Close immediately, fire-and-forget save (optimistic). Toast on failure.
    onOpenChange(false);
    try {
      await logMood(value);
    } catch (e) {
      toast.error(
        `Couldn't save mood: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={() => onOpenChange(false)}
      />
      <div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-2xl flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div
            className="w-9 h-1 rounded-full"
            style={{ backgroundColor: "var(--border)" }}
          />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <span
            className="text-base font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            How are you feeling?
          </span>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--muted)" }}
          >
            <X size={14} style={{ color: "var(--muted-foreground)" }} />
          </button>
        </div>

        <div
          className="px-6 pt-2"
          style={{
            paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          }}
        >
          <MoodSlider value={value} onChange={setValue} />

          <button
            onClick={handleDone}
            disabled={saving}
            className="w-full py-3.5 rounded-xl text-sm font-semibold mt-6"
            style={{
              backgroundColor: saving ? "var(--muted)" : "var(--foreground)",
              color: saving ? "var(--muted-foreground)" : "var(--background)",
              transition: "background-color 0.15s ease",
            }}
          >
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/mood/mood-sheet.tsx
git commit -m "feat(mood): add MoodSheet bottom sheet"
```

---

## Task 11: Frontend — `MoodButton` component

**Files:**
- Create: `frontend/components/mood/mood-button.tsx`

- [ ] **Step 1: Create the file**

Write `frontend/components/mood/mood-button.tsx` with:

```typescript
"use client";

import { Smile } from "lucide-react";

interface MoodButtonProps {
  onClick: () => void;
}

export function MoodButton({ onClick }: MoodButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Log mood"
      className="w-8 h-8 rounded-lg flex items-center justify-center"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <Smile size={16} style={{ color: "var(--muted-foreground)" }} />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/mood/mood-button.tsx
git commit -m "feat(mood): add MoodButton header icon"
```

---

## Task 12: Wire `MoodButton` into the Header

**Files:**
- Modify: `frontend/components/layout/header.tsx`

- [ ] **Step 1: Add the mood prop and render the button**

Replace the entire contents of `frontend/components/layout/header.tsx` with:

```typescript
"use client";

import { Settings, BarChart3 } from "lucide-react";
import { MoodButton } from "@/components/mood/mood-button";
import { CountUp } from "@/components/ui/count-up";

export function Header({
  onSettingsClick,
  onStatsClick,
  onMoodClick,
  ideaCount = 0,
}: {
  onSettingsClick: () => void;
  onStatsClick?: () => void;
  onMoodClick?: () => void;
  ideaCount?: number;
}) {
  return (
    <header
      className="flex items-center justify-between px-4 sticky top-0 z-40"
      style={{
        backgroundColor: "var(--background)",
        paddingTop: "calc(env(safe-area-inset-top) + 12px)",
        paddingBottom: 12,
      }}
    >
      <div>
        <h1 className="text-xl font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, var(--foreground), var(--muted-foreground))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
          think tank
        </h1>
        {ideaCount > 0 && (
          <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <CountUp target={ideaCount} /> ideas
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onMoodClick && <MoodButton onClick={onMoodClick} />}
        {onStatsClick && (
          <button
            onClick={onStatsClick}
            aria-label="Stats"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <BarChart3 size={16} style={{ color: "var(--muted-foreground)" }} />
          </button>
        )}
        <button
          onClick={onSettingsClick}
          aria-label="Settings"
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <Settings size={16} style={{ color: "var(--muted-foreground)" }} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/layout/header.tsx
git commit -m "feat(mood): wire MoodButton into Header"
```

---

## Task 13: Wire `MoodSheet` into `HomeClient`

**Files:**
- Modify: `frontend/components/home-client.tsx`

- [ ] **Step 1: Add import, state, sheet render, and header prop**

In `frontend/components/home-client.tsx`:

1. After the existing import for `CaptureSheet`, add this import line:
```typescript
import { MoodSheet } from "@/components/mood/mood-sheet";
```

2. Inside the `HomeClient` component, next to the existing `const [statsOpen, setStatsOpen] = useState(false);` line, add:
```typescript
  const [moodOpen, setMoodOpen] = useState(false);
```

3. Find every call to `<Header ... />` in this file. For each one, add a new prop `onMoodClick={() => setMoodOpen(true)}` alongside the existing `onSettingsClick` and `onStatsClick` props.

4. Somewhere in the JSX where other top-level sheets/dialogs live (e.g., near `<CaptureSheet ... />`), add:
```typescript
      <MoodSheet open={moodOpen} onOpenChange={setMoodOpen} />
```

- [ ] **Step 2: Rebuild the frontend container**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache nextjs && docker compose up -d --force-recreate nextjs
```

- [ ] **Step 3: Verify the button appears and the sheet opens**

Open the app at `http://localhost:3004` (or via Tailscale). Confirm:
1. A smiley-face icon appears in the header, to the left of the bar chart (stats) icon.
2. Tapping the smiley opens a bottom sheet titled "How are you feeling?".
3. The slider thumb starts at the middle (Neutral).
4. Dragging the slider updates the label below it (Very Unpleasant → Very Pleasant as you drag).
5. Tapping Done closes the sheet.
6. Tapping the backdrop or X closes the sheet without saving.

- [ ] **Step 4: Verify the mood persists on the backend**

After tapping Done with the slider at e.g. Pleasant (value 6), check:
```bash
curl -s http://localhost:6000/moods?days=1 \
  -H "X-Think-Tank-User: ardi" | python3 -m json.tool
```

Expected: the new mood appears with `"mood_value": 6`.

- [ ] **Step 5: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/home-client.tsx
git commit -m "feat(mood): wire MoodSheet into HomeClient"
```

---

## Task 14: Frontend — `MoodGraph` component

**Files:**
- Create: `frontend/components/mood/mood-graph.tsx`

- [ ] **Step 1: Create the file**

Write `frontend/components/mood/mood-graph.tsx` with:

```typescript
"use client";

import { MOOD_COLORS, colorForValue, type MoodValue } from "@/lib/mood";
import type { Mood } from "@/lib/types";

interface MoodGraphProps {
  moods: Mood[];
  days: number;
}

// Render an SVG line graph of mood values over time, with faint background
// zone bands for each of the 7 mood levels. Expects at least 0 moods.
export function MoodGraph({ moods, days }: MoodGraphProps) {
  const W = 320;
  const H = 140;
  const PAD_L = 34;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 18;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // Map a mood value (1-7) to a y coordinate. Higher value = higher on screen.
  function yFor(value: number) {
    return PAD_T + plotH - ((value - 1) / 6) * plotH;
  }

  // Map a timestamp ("YYYY-MM-DD HH:MM:SS") to an x coordinate across the window.
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const windowStart = now - windowMs;

  function tsToMs(ts: string) {
    const [date, time] = ts.split(" ");
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm, ss] = (time || "0:0:0").split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, ss).getTime();
  }

  function xFor(ts: string) {
    const t = tsToMs(ts);
    const clamped = Math.max(windowStart, Math.min(now, t));
    const frac = (clamped - windowStart) / windowMs;
    return PAD_L + frac * plotW;
  }

  const points = moods.map((m) => ({
    x: xFor(m.timestamp),
    y: yFor(m.mood_value),
    value: m.mood_value,
    id: m.id,
  }));

  const polyline =
    points.length >= 2
      ? points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
      : "";

  // 7 background bands, one per mood level.
  const bandHeight = plotH / 7;
  const bands = ([1, 2, 3, 4, 5, 6, 7] as MoodValue[]).map((v, i) => ({
    y: PAD_T + (6 - i) * bandHeight,
    color: MOOD_COLORS[v],
    value: v,
  }));

  return (
    <div style={{ width: "100%", overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        preserveAspectRatio="none"
      >
        {/* Zone bands */}
        {bands.map((b) => (
          <rect
            key={b.value}
            x={PAD_L}
            y={b.y}
            width={plotW}
            height={bandHeight}
            fill={b.color}
            opacity={0.08}
          />
        ))}

        {/* Y-axis labels */}
        <text x={PAD_L - 4} y={yFor(7) + 3} textAnchor="end" fontSize="7" fill="var(--muted-foreground)">
          V. Pleasant
        </text>
        <text x={PAD_L - 4} y={yFor(4) + 3} textAnchor="end" fontSize="7" fill="var(--muted-foreground)">
          Neutral
        </text>
        <text x={PAD_L - 4} y={yFor(1) + 3} textAnchor="end" fontSize="7" fill="var(--muted-foreground)">
          V. Unpleasant
        </text>

        {/* Gradient definition for the line */}
        <defs>
          <linearGradient id="moodLineGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={MOOD_COLORS[1]} />
            <stop offset="50%" stopColor={MOOD_COLORS[4]} />
            <stop offset="100%" stopColor={MOOD_COLORS[7]} />
          </linearGradient>
        </defs>

        {/* Line */}
        {polyline && (
          <polyline
            points={polyline}
            fill="none"
            stroke="url(#moodLineGrad)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Points */}
        {points.map((p) => (
          <circle key={p.id} cx={p.x} cy={p.y} r="3" fill={colorForValue(p.value)} />
        ))}

        {/* X-axis caption */}
        <text x={PAD_L} y={H - 4} fontSize="7" fill="var(--muted-foreground)">
          {days} days ago
        </text>
        <text x={W - PAD_R} y={H - 4} textAnchor="end" fontSize="7" fill="var(--muted-foreground)">
          today
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/mood/mood-graph.tsx
git commit -m "feat(mood): add MoodGraph SVG component"
```

---

## Task 15: Frontend — `MoodAverage` component

**Files:**
- Create: `frontend/components/mood/mood-average.tsx`

- [ ] **Step 1: Create the file**

Write `frontend/components/mood/mood-average.tsx` with:

```typescript
"use client";

import { colorForValue } from "@/lib/mood";

interface MoodAverageProps {
  average: number | null;
  averageLabel: string | null;
  days: number;
}

export function MoodAverage({ average, averageLabel, days }: MoodAverageProps) {
  if (average === null || averageLabel === null) {
    return (
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        Log a mood to see your average here.
      </p>
    );
  }
  const dotColor = colorForValue(average);
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: dotColor,
        }}
      />
      <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        Last {days} days: {averageLabel}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/mood/mood-average.tsx
git commit -m "feat(mood): add MoodAverage label component"
```

---

## Task 16: Integrate mood section into `StatsView`

**Files:**
- Modify: `frontend/components/stats/stats-view.tsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/components/stats/stats-view.tsx`, just after the existing imports (e.g., after `import { fetchStatsData } from "@/lib/api";`), add:

```typescript
import { MoodGraph } from "@/components/mood/mood-graph";
import { MoodAverage } from "@/components/mood/mood-average";
import { useMoods } from "@/lib/hooks/use-moods";
```

- [ ] **Step 2: Fetch mood data inside the component**

Inside the `StatsView` function component, right after the existing `const { data, isLoading } = useSWR("stats-data", ...);` line, add:

```typescript
  const MOOD_DAYS = 30;
  const { data: moodData } = useMoods(MOOD_DAYS);
```

- [ ] **Step 3: Render the mood section in the stats view**

Inside the returned JSX, immediately after the `{/* Hero */}` block (the `<div className="text-center py-4">...</div>` that ends with the `since {stats.sinceStr}` text), and before `{/* Quick stats */}`, insert:

```typescript
      {/* Mood */}
      <div>
        <SectionLabel>Mood</SectionLabel>
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="mb-3">
            <MoodAverage
              average={moodData?.average ?? null}
              averageLabel={moodData?.average_label ?? null}
              days={MOOD_DAYS}
            />
          </div>
          <MoodGraph moods={moodData?.moods ?? []} days={MOOD_DAYS} />
        </div>
      </div>
```

- [ ] **Step 4: Rebuild the frontend**

Run:
```bash
cd /home/ardi/Projects/think_tank && docker compose build --no-cache nextjs && docker compose up -d --force-recreate nextjs
```

- [ ] **Step 5: Verify in the browser**

Open the app, tap the Stats (bar chart) icon in the header. Confirm:
1. A new "Mood" section appears near the top of the stats view, below the big idea count hero.
2. If no moods have been logged yet, the placeholder text "Log a mood to see your average here." shows up and the graph is empty (zone bands only).
3. Log a few moods via the mood button (cover the whole range: one very unpleasant, one neutral, one very pleasant), then reopen stats. Confirm:
   - The average label reflects the rough midpoint of your logs (e.g., "Last 30 days: Neutral" if you logged 1, 4, 7).
   - The dot color before the label matches the rounded average's color.
   - The graph shows circles at the correct y positions, connected by a gradient line (if ≥2 points).

- [ ] **Step 6: Confirm feed still loads at the same speed**

Pull the feed tab to refresh. It should feel identical to before — no new data fetches, no stalls. (There is no automated benchmark for this — it's a spot-check per the spec's performance constraint.)

- [ ] **Step 7: Commit**

```bash
cd /home/ardi/Projects/think_tank
git add frontend/components/stats/stats-view.tsx
git commit -m "feat(mood): add Mood section to StatsView"
```

---

## Task 17: Final integration sanity check

**Files:** none (verification only)

- [ ] **Step 1: Confirm both containers are healthy**

Run:
```bash
docker ps --filter "name=think_tank" --format "table {{.Names}}\t{{.Status}}"
```

Expected: both `think_tank_api` and `think_tank_frontend` show `Up` and `(healthy)` if a healthcheck is configured.

- [ ] **Step 2: Full end-to-end walkthrough**

On the iPhone PWA (or desktop browser via Tailscale):

1. Open the app. Smiley icon is in the header, left of the stats icon.
2. Log a mood at Very Pleasant (drag slider far right). Sheet closes, no visible delay.
3. Log another at Very Unpleasant. Sheet closes, no visible delay.
4. Log one at Neutral.
5. Open Stats. Mood section shows three points, line connects them with a gradient, average label reads "Last 30 days: Neutral" (or similar depending on exact distribution).
6. Capture a new idea via the + button. Feed behavior is unchanged.
7. Search still works.
8. Tap the sketch tab. Sketch pad loads normally.

- [ ] **Step 3: Spot-check the read path performance**

Time a Flask request to `/ideas` against the mood-free baseline. Run:
```bash
time curl -s -o /dev/null http://localhost:6000/ideas?limit=50 \
  -H "X-Think-Tank-User: ardi"
```

Expected: comparable to pre-change timings (anywhere under ~200ms on a warm SQLite cache). The /ideas query was not touched, so there should be no regression.

- [ ] **Step 4: Final commit (if any stragglers)**

Run:
```bash
cd /home/ardi/Projects/think_tank && git status
```

If nothing uncommitted, skip. Otherwise stage and commit.

---

## Self-Review Notes

- **Spec coverage:**
  - Data model (7-stop scale, nullable future columns, index) → Task 1.
  - POST/GET/DELETE endpoints → Tasks 2/3/4.
  - Mood constants + types + API helpers → Tasks 5/6/7.
  - Hook → Task 8.
  - Slider + Sheet + Button → Tasks 9/10/11.
  - Wire into Header + HomeClient → Tasks 12/13.
  - Graph + Average → Tasks 14/15.
  - Integrate into StatsView → Task 16.
  - End-to-end verification → Task 17.
- **Performance constraint:** Task 16 step 6 and Task 17 step 3 spot-check that existing flows are not regressed. No changes to the `ideas` table, no new queries on app load.
- **Future extensibility:** Preserved via nullable columns on the `moods` table (Task 1) and documented in the spec's Future Extensions section.
