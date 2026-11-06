// Session-scoped consent flag (PRD §12, Philippine Data Privacy Act of 2012 /
// RA 10173). Shared by the Risk Assessment and the General CKD Chatbot, so a
// participant consents once per session before either one receives input.
//
// v2: the consent screen now carries the UIC-REC eligibility confirmations
// (20 or older, no end-stage kidney disease / dialysis) and the AI and
// data-handling disclosures. Anyone who agreed to the v1 text is asked again.

const KEY = "bato-consent-v2";

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
