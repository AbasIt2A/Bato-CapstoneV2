// Researcher-set participant code for evaluation sessions.
//
// During the Sprint 6 evaluation the researcher opens BATO for each
// participant with ?pid=P07 (any "P" followed by 1–4 digits). The code is
// held in sessionStorage for that tab, removed from the address bar straight
// away, and sent with every chat request so the server can store it on the
// participant's chat_audit_log rows. That is what lets the research team
// delete one participant's rows if they withdraw (delete_participant_audit_rows).
//
// Never shown to the participant and never asked of them. Anything that is
// not the exact P-plus-digits format is ignored, and the server validates it
// again (see audit-log.ts), so no free text can reach the column.

const KEY = "bato-participant-code";
const PARAM = "pid";

/** Mirrors PARTICIPANT_CODE_PATTERN in supabase/functions/_shared/audit-log.ts. */
export const PARTICIPANT_CODE_PATTERN = /^P\d{1,4}$/;

export function normalizeParticipantCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return PARTICIPANT_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Reads ?pid= once at startup, keeps a valid code for this tab, and strips
 * the parameter from the URL either way. Call before the app renders.
 */
export function captureParticipantCode(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  const code = normalizeParticipantCode(url.searchParams.get(PARAM));
  try {
    if (code) sessionStorage.setItem(KEY, code);
  } catch {
    // sessionStorage unavailable — the session simply goes uncoded
  }
  url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
}

/** The code set for this tab, or null outside a coded evaluation session. */
export function getParticipantCode(): string | null {
  try {
    return normalizeParticipantCode(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}
