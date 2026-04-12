"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({ target }: { target: number }) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (target === 0) return;
    const start = Date.now();
    const duration = 600;
    const animate = () => {
      const progress = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  return <>{value}</>;
}
