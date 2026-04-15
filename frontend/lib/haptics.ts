// Lightweight haptic helper. Calls navigator.vibrate when available.
//
// Platform reality (as of writing):
//   - Android Chrome / Firefox / Samsung: works, triggers a hardware buzz.
//   - iOS Safari (incl. installed PWAs): navigator.vibrate is a no-op. Apple
//     has never shipped the Vibration API. Real Taptic engine access requires
//     a native app. Calling this on iOS is harmless and forward-compatible —
//     the day Safari enables it, every call site lights up for free.
//
// Use `tap()` for micro-interactions (button presses, toggles), `success()`
// when an action completes, `warning()` for mistakes/errors.

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw if called from a non-user-gesture context — ignore.
  }
}

export const haptics = {
  tap: () => vibrate(8),
  success: () => vibrate([10, 40, 20]),
  warning: () => vibrate([30, 60, 30]),
};
