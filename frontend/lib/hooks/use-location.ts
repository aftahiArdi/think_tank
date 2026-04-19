"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Auto-attach design: the capture sheet calls `prime()` on open, which fires
// a background GPS request with a 5-minute cache window — on second+ use it
// returns instantly from the OS cache. When the user taps Save, `getLatest()`
// returns whatever coords are ready (often already primed), or null. The
// capture path NEVER awaits GPS.
//
// To switch to manual later, toggle `localStorage['tt-location-auto']` to '0'
// or wire the MoodSheet-style button to call `prime()` on demand instead of
// on open — no backend changes needed.

export type LocationStatus =
  | "idle"
  | "priming"
  | "ready"
  | "denied"
  | "unsupported"
  | "failed";

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
}

const AUTO_KEY = "tt-location-auto";
const MAX_AGE_MS = 5 * 60 * 1000; // accept OS-cached fixes up to 5 min old
const TIMEOUT_MS = 12000; // high-accuracy GPS can take 5-10s for first fix

// Module-level cache so the last fix survives sheet open/close cycles.
let cachedFix: LocationFix | null = null;
let inflight: Promise<LocationFix | null> | null = null;

export function isAutoLocationEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTO_KEY) !== "0";
}

export function setAutoLocationEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_KEY, enabled ? "1" : "0");
}

async function requestFix(): Promise<LocationFix | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: LocationFix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        cachedFix = fix;
        resolve(fix);
      },
      () => resolve(null),
      {
        // High-accuracy trades 5-8s of first-fix latency for ~5-10m precision
        // (vs 20-500m with WiFi triangulation) — enough to resolve named buildings
        // like libraries or cafés. Subsequent captures within MAX_AGE_MS reuse the cache.
        enableHighAccuracy: true,
        maximumAge: MAX_AGE_MS,
        timeout: TIMEOUT_MS,
      },
    );
  });
}

export function useLocation() {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const prime = useCallback(async () => {
    if (!isAutoLocationEnabled()) return null;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (mountedRef.current) setStatus("unsupported");
      return null;
    }

    // Honor "denied" permission without triggering a request.
    try {
      const perms = await navigator.permissions?.query({
        name: "geolocation" as PermissionName,
      });
      if (perms?.state === "denied") {
        if (mountedRef.current) setStatus("denied");
        return null;
      }
    } catch {
      // permissions API missing (older Safari) — fall through and try anyway
    }

    if (cachedFix && Date.now() - cachedFix.capturedAt < MAX_AGE_MS) {
      if (mountedRef.current) setStatus("ready");
      return cachedFix;
    }

    if (!inflight) {
      inflight = requestFix().finally(() => {
        inflight = null;
      });
    }

    if (mountedRef.current) setStatus("priming");
    const fix = await inflight;
    if (!mountedRef.current) return fix;
    setStatus(fix ? "ready" : "failed");
    return fix;
  }, []);

  const getLatest = useCallback((): LocationFix | null => {
    if (!isAutoLocationEnabled()) return null;
    if (cachedFix && Date.now() - cachedFix.capturedAt < MAX_AGE_MS) {
      return cachedFix;
    }
    return null;
  }, []);

  return { status, prime, getLatest };
}
