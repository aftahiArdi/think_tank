"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint } from "lucide-react";
import {
  isBiometricAvailable,
  isBiometricEnabled,
  registerBiometric,
} from "@/lib/biometric";

export function PasswordGate() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showBiometricSetup, setShowBiometricSetup] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const router = useRouter();

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      // If biometric is available but not set up, offer it
      if (biometricAvailable && !isBiometricEnabled()) {
        setShowBiometricSetup(true);
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong password");
      setPassword("");
    }
    setLoading(false);
  };

  const handleEnableBiometric = async () => {
    const ok = await registerBiometric();
    if (!ok) {
      setError("Face ID setup failed. You can enable it later in settings.");
    }
    router.push("/");
    router.refresh();
  };

  const handleSkipBiometric = () => {
    router.push("/");
    router.refresh();
  };

  if (showBiometricSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-xs space-y-6 text-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <Fingerprint size={40} style={{ color: "var(--primary)" }} />
          </div>
          <div>
            <h2
              className="text-xl font-bold"
              style={{ color: "var(--foreground)" }}
            >
              Enable Face ID?
            </h2>
            <p
              className="text-sm mt-2"
              style={{ color: "var(--muted-foreground)" }}
            >
              Unlock Think Tank with Face ID instead of typing your password
              every time.
            </p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="space-y-2">
            <Button onClick={handleEnableBiometric} className="w-full">
              Enable Face ID
            </Button>
            <Button
              onClick={handleSkipBiometric}
              variant="ghost"
              className="w-full"
              style={{ color: "var(--muted-foreground)" }}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <h1 className="text-2xl font-bold text-center"
            style={{ color: "var(--foreground)" }}>
          think tank
        </h1>
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="text-center"
        />
        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "..." : "Enter"}
        </Button>
      </form>
    </div>
  );
}
