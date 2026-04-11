"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import {
  isBiometricAvailable,
  isBiometricEnabled,
  registerBiometric,
  disableBiometric,
} from "@/lib/biometric";

export function BiometricToggle() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setAvailable);
    setEnabled(isBiometricEnabled());
  }, []);

  if (!available) return null;

  async function toggle() {
    if (enabled) {
      disableBiometric();
      setEnabled(false);
    } else {
      const ok = await registerBiometric();
      setEnabled(ok);
    }
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
        <Fingerprint size={20} style={{ color: "var(--foreground)" }} />
        <span className="text-sm" style={{ color: "var(--foreground)" }}>
          Face ID Lock
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
