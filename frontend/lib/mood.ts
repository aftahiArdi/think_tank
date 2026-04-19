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
