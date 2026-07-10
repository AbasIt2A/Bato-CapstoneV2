// Session-scoped consent flag (PRD §12, Philippine Data Privacy Act of 2012 /
// RA 10173). Same key as the capstone frontend so behavior matches.

const KEY = "bato-consent-v1";

export function hasConsented(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "yes";
  } catch {
    return false;
  }
}

export function recordConsent(): void {
  try {
    sessionStorage.setItem(KEY, "yes");
  } catch {
    // sessionStorage unavailable (private mode restrictions) — proceed anyway
  }
}
