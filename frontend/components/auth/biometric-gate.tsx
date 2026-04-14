"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isBiometricEnabled, verifyBiometric } from "@/lib/biometric";
import { Fingerprint } from "lucide-react";

const SESSION_KEY = "tt-unlocked";

function computeInitialState(pathname: string): "locked" | "unlocked" {
  if (typeof window === "undefined") return "unlocked";
  if (pathname === "/login") return "unlocked";
  if (!isBiometricEnabled()) return "unlocked";
  if (sessionStorage.getItem(SESSION_KEY) === "1") return "unlocked";
  return "locked";
}

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Synchronous initial decision — no network round-trip, no "checking" flash
  const [state, setState] = useState<"locked" | "unlocked">(() => computeInitialState(pathname));
  const [error, setError] = useState("");
  const prompted = useRef(false);

  useEffect(() => {
    if (state === "locked") doPrompt();
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
