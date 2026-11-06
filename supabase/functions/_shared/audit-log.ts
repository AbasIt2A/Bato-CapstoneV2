// Safety audit log for the two chatbots (UIC-REC protocol UG-ER-09-26-0744:
// "a continuous safety audit log during Sprint 6 to verify that no
// inaccurate clinical explanations are served to human participants").
//
// One row per chatbot reply: what the participant asked, exactly what BATO
// showed them, the sources it cited, and whether it answered, deflected or
// failed. The research team reviews these rows for accuracy.
//
// The log lives in BATO's OWN database (chat_audit_log), never in function
// logs — those are kept by the hosting provider and fall under the
// zero-retention requirement, while this table falls under the study's own
// retention and disposal schedule and is disclosed in the ICF. The table has
// RLS enabled and no policies: only the service role (server code and the
// research team's dashboard access) can read it.
//
// The question is passed through the personal-details filter immediately
// before the insert, so the table only ever holds filtered text. The Edge
// Functions filter it earlier too; filtering again here is the backstop for
// any path that does not, and it is a no-op on text already filtered.
//
// No user or session id is stored. The one link to a person is the optional
// researcher-set participant code (?pid=P07 in the browser, see
// frontend/src/lib/participant-code.ts), which exists so a withdrawing
// participant's rows can be deleted. Anything that is not the exact P-plus-
// digits format is stored as null, and the column's CHECK constraint
// enforces the same format in the database.
//
// Recording is wrapped around the whole handler, so every reply — including
// deflections and service errors from any return path — is captured without
// threading a logger through the pipeline. It never throws and never changes
// the response the participant receives.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RetrievalScope } from "./scopes.ts";
import { redactPersonalDetails } from "./personal-details.ts";

export type AuditOutcome = "answered" | "deflected" | "service_error";

/** Set CHAT_AUDIT_LOG_ENABLED=false to stop recording. On by default. */
export function auditLogEnabled(): boolean {
  try {
    return Deno.env.get("CHAT_AUDIT_LOG_ENABLED") !== "false";
  } catch {
    return true; // no env permission (offline tests)
  }
}

/**
 * Mirrors the chat_audit_log CHECK constraint and PARTICIPANT_CODE_PATTERN in
 * frontend/src/lib/participant-code.ts.
 */
export const PARTICIPANT_CODE_PATTERN = /^P\d{1,4}$/;

/** A valid participant code, upper-cased, or null for anything else. */
export function normalizeParticipantCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return PARTICIPANT_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Classifies a reply body. `deflected` is true on the wire for both refusals
 * and infrastructure failures (see serviceError() in general-chat), so the
 * service-error text is what tells the two apart.
 */
export function auditOutcome(
  body: { reply?: unknown; deflected?: unknown },
  serviceErrorMessage: string,
): AuditOutcome {
  if (body.reply === serviceErrorMessage) return "service_error";
  return body.deflected === true ? "deflected" : "answered";
}

/**
 * Runs `handle` and records the exchange. `questionField` names the request
 * field holding the participant's text ("message" for general-chat,
 * "question" for clarify).
 */
export async function withChatAudit(
  req: Request,
  options: {
    supabase: () => SupabaseClient;
    scope: RetrievalScope;
    questionField: string;
    serviceErrorMessage: string;
  },
  handle: (req: Request) => Promise<Response>,
): Promise<Response> {
  const auditable = req.method === "POST" && auditLogEnabled();
  const requestCopy = auditable ? req.clone() : null;
  const response = await handle(req);
  if (!requestCopy || !response.ok) return response;

  try {
    const request = await requestCopy.json() as Record<string, unknown>;
    const question = request[options.questionField];
    const body = await response.clone().json() as Record<string, unknown>;
    if (typeof question !== "string" || typeof body.reply !== "string") {
      return response;
    }
    const { error } = await options.supabase().from("chat_audit_log").insert({
      scope: options.scope,
      question: redactPersonalDetails(question.trim()),
      reply: body.reply,
      sources: Array.isArray(body.sources) ? body.sources : [],
      outcome: auditOutcome(body, options.serviceErrorMessage),
      participant_code: normalizeParticipantCode(request.participantCode),
    });
    if (error) console.warn("audit-log: insert failed:", error.message);
  } catch (err) {
    console.warn("audit-log: not recorded:", err);
  }
  return response;
}
