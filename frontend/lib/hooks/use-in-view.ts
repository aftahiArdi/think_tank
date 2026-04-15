import { useEffect, useRef, useState } from "react";

// Fires once when the element first enters the viewport and stays true after.
// Used to defer expensive work (e.g. external metadata fetches) until the card
// is actually on screen, so a 30-card feed doesn't fan out 30 network calls
// before the user has even scrolled.
export function useInView<T extends Element>(rootMargin = "200px 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
