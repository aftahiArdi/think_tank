/**
 * Biometric (Face ID / Touch ID) lock using WebAuthn.
 * This is a LOCAL device lock — the cookie handles real auth.
 *
 * We do NOT store the credential ID. Instead, we let the platform
 * (iCloud Keychain) find the credential by origin. This avoids the
 * "credential ID stale" failure where iCloud Keychain syncs or rotates
 * the passkey but our stored ID no longer matches.
 *
 * Credentials are scoped per-username via the WebAuthn user.id field,
 * and the enabled flag in localStorage is keyed per-username.
 */

const CURRENT_USER_KEY = "tt-current-user";

/**
 * Get the currently logged-in username.
 * Reads from the non-HttpOnly `think_tank_user` cookie (set by server at login) —
 * synchronous, zero network cost. Falls back to localStorage for existing sessions
 * that predate the cookie being added.
 */
export function getCurrentUsername(): string | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("think_tank_user="));
  if (match) {
    const val = match.slice("think_tank_user=".length);
    if (val) return val;
  }
  return localStorage.getItem(CURRENT_USER_KEY) || null;
}

/** Called by password-gate after successful login — belt-and-suspenders localStorage backup. */
export function setCurrentUsername(username: string): void {
  localStorage.setItem(CURRENT_USER_KEY, username);
}

function enabledKey(username: string): string {
  return `think-tank-biometric-enabled:${username}`;
}

export function isBiometricSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
  );
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isBiometricEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const username = getCurrentUsername();
  if (!username) return false;
  return localStorage.getItem(enabledKey(username)) === "true";
}

export function disableBiometric(): void {
  const username = getCurrentUsername();
  if (!username) return;
  localStorage.removeItem(enabledKey(username));
}

export async function registerBiometric(): Promise<boolean> {
  const username = getCurrentUsername();
  if (!username) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Think Tank" },
        user: {
          id: new TextEncoder().encode(username),
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },   // ES256
          { alg: -257, type: "public-key" },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return false;

    // Only store the enabled flag — NOT the credential ID.
    // The platform (iCloud Keychain) owns the credential and finds it by origin.
    localStorage.setItem(enabledKey(username), "true");
    return true;
  } catch {
    return false;
  }
}

export async function verifyBiometric(): Promise<boolean> {
  const username = getCurrentUsername();
  if (!username) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    // Empty allowCredentials — let the platform find any credential for this origin.
    // Since this is a personal Tailscale URL, there's only one passkey per user.
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [],
        userVerification: "required",
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch {
    return false;
  }
}
