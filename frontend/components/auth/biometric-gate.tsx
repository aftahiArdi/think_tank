"use client";

import { useEffect, useRef, useState } from "react";
import { isBiometricEnabled, verifyBiometric } from "@/lib/biometric";
import { Fingerprint } from "lucide-react";

const SESSION_KEY = "tt-unlocked";

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [error, setError] = useState("");
  const prompted = useRef(false);

  useEffect(() => {
    // Runs client-side only — check local state immediately, no network needed
    if (!isBiometricEnabled()) {
      setState("unlocked");
      return;
    }
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setState("unlocked");
      return;
    }
    setState("locked");
    doPrompt();
  }, []);

  async function doPrompt() {
    if (prompted.current) return;
    prompted.current = true;
    setError("");
    const ok = await verifyBiometric();
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setState("unlocked");
    } else {
      prompted.current = false;
      setState("locked");
      setError("Verification failed. Tap to try again.");
    }
  }

  if (state === "unlocked") return <>{children}</>;

  if (state === "checking") {
    return <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} />;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--background)" }}
    >
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
          think tank
        </h1>
        <button
          onClick={doPrompt}
          className="mx-auto flex flex-col items-center gap-3 active:opacity-70 transition-opacity"
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <Fingerprint size={40} style={{ color: "var(--primary)" }} />
          </div>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Tap to unlock with Face ID
          </p>
        </button>
        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  );
}
