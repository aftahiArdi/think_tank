"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import {
  isAutoLocationEnabled,
  setAutoLocationEnabled,
} from "@/lib/hooks/use-location";

export function LocationToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isAutoLocationEnabled());
  }, []);

  function toggle() {
    const next = !enabled;
    setAutoLocationEnabled(next);
    setEnabled(next);
  }

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center justify-between rounded-xl px-4 py-3"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <MapPin size={20} style={{ color: "var(--foreground)" }} />
        <span className="text-sm" style={{ color: "var(--foreground)" }}>
          Attach location
        </span>
      </div>
      <div
        className="w-11 h-6 rounded-full relative transition-colors"
        style={{
          backgroundColor: enabled ? "var(--primary)" : "var(--muted)",
        }}
      >
        <div
          className="w-5 h-5 rounded-full absolute top-0.5 transition-all"
          style={{
            backgroundColor: enabled
              ? "var(--primary-foreground)"
              : "var(--muted-foreground)",
            left: enabled ? "22px" : "2px",
          }}
        />
      </div>
    </button>
  );
}
