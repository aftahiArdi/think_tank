"use client";

import { useEffect, useRef } from "react";

interface AuroraProps {
  colorStops?: string[];
  speed?: number;
  amplitude?: number;
}

export function Aurora({
  colorStops = ["#3b82f6", "#8b5cf6", "#ec4899"],
  speed = 0.5,
  amplitude = 0.4,
}: AuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      timeRef.current += speed * 0.01;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const waves = colorStops.length;
      for (let i = 0; i < waves; i++) {
        const phase = (i / waves) * Math.PI * 2;
        const yBase = height * (0.3 + (i / waves) * 0.4);

        ctx.beginPath();
        ctx.moveTo(0, height);

        for (let x = 0; x <= width; x += 4) {
          const y =
            yBase +
            Math.sin(x * 0.004 + timeRef.current + phase) * height * amplitude * 0.3 +
            Math.sin(x * 0.007 + timeRef.current * 1.3 + phase) * height * amplitude * 0.2;
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, `${colorStops[i]}00`);
        grad.addColorStop(0.5, `${colorStops[i]}40`);
        grad.addColorStop(1, `${colorStops[(i + 1) % waves]}00`);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [colorStops, speed, amplitude]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0, opacity: 0.6 }}
    />
  );
}
