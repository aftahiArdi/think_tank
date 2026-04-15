// Module-level in-flight lock for daily summary generation, keyed by date.
//
// A single summary call takes 30-120s on CPU-Ollama, so the user can easily
// leave the tab, come back, and re-tap — spawning a second request that the
// backend would happily queue behind the first. This lock survives component
// re-mounts because it lives at the module level, not in React state.
//
// Subscribers are notified so UI in multiple surfaces (Recap tab's TodayCard
// and the /recap/[date] detail page) stay in sync without shared React state.

type Listener = () => void;

const inflight = new Set<string>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function isSummaryInflight(date: string): boolean {
  return inflight.has(date);
}

export function acquireSummaryLock(date: string): boolean {
  if (inflight.has(date)) return false;
  inflight.add(date);
  notify();
  return true;
}

export function releaseSummaryLock(date: string): void {
  inflight.delete(date);
  notify();
}

export function subscribeSummaryLock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
