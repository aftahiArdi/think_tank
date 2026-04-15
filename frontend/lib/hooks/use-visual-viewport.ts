import { useEffect, useState } from "react";

// Tracks the iOS (and modern Android) visual viewport so sheets/dialogs can
// stay above the on-screen keyboard. `window.innerHeight` and `100dvh` do NOT
// respond to the soft keyboard on iOS — only `window.visualViewport` does.
//
// Returns the pixel height of the keyboard (0 when no keyboard), computed as
// `window.innerHeight - (visualViewport.height + visualViewport.offsetTop)`.
// Add this as a `bottom` offset to a `position: fixed; bottom: 0` sheet and
// the sheet will lift above the keyboard exactly as it slides in.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;

    const update = () => {
      // offsetTop > 0 when the page has scrolled because of the keyboard.
      // innerHeight stays constant; vv.height shrinks by the keyboard height.
      const next = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(next);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}

// Convenience alias when callers want the whole viewport shape, not just the
// keyboard inset.
export function useVisualViewport() {
  const keyboardInset = useKeyboardInset();
  return { keyboardInset };
}
