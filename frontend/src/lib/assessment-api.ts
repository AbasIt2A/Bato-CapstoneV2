// Client for the Risk Assessment backend, all of it in this project now:
//
//   `screening` — the SCORED state machine and deterministic scoring, ported
//     from the original capstone project and reused as-is, never
//     reimplemented. It owns the assessment and every recorded answer.
//
//   `clarify`  — the retrieval-grounded LLM Clarification Engine. It takes
//     ONLY a question (plus an optional variableKey retrieval hint) and
//     returns prose + citations. It deliberately receives no assessmentId
//     and returns no step: it cannot read or write a SCORED variable, and
//     THIS CLIENT keeps the current step and re-displays it after the aside.
//     Do not "helpfully" pass assessment state to it — that would dismantle
//     the structural guarantee the function is built around.
//
// Auth: an anonymous supabase-js session, attached automatically to
// functions.invoke().

import { ensureSession, getSupabaseClient } from "./supabase-client";

export interface StepPayload {
  index: number;
  total: number;
  key: string;
  prompt: string;
  inputType: "number" | "choice";
  options?: string[];
}

export interface ScreeningResult {
  totalScore: number;
  classification: "Screen Positive" | "Screen Negative";
}

export interface StartResponse {
  assessmentId: string;
  step: StepPayload;
}

// One shape for the three server variants: invalid answer (valid=false +
// message + same step), accepted (valid=true + next step), and completed
// (valid=true + completed + result).
export interface AnswerResponse {
  valid: boolean;
  message?: string;
  step?: StepPayload;
  completed?: boolean;
  result?: ScreeningResult;
}

export interface SourceCitation {
  source: string;
  title: string;
  heading_path: string | null;
}

export interface ClarifyResponse {
  reply: string;
  sources: SourceCitation[];
  /** True when the engine declined — the reply is the approved deflection. */
  deflected: boolean;
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = getSupabaseClient();
  await ensureSession();
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError carries the raw Response; surface the server's
    // { error } detail when present instead of the generic message.
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed: unknown = ctx ? await ctx.json() : null;
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        detail = String((parsed as { error: unknown }).error);
      }
    } catch {
      // keep the generic message
    }
    throw new Error(detail);
  }
  return data as T;
}

export function startScreening(): Promise<StartResponse> {
  return invoke<StartResponse>("screening", { action: "start" });
}

export function submitAnswer(
  assessmentId: string,
  value: string,
): Promise<AnswerResponse> {
  return invoke<AnswerResponse>("screening", {
    action: "answer",
    assessmentId,
    value,
  });
}

export function abandonScreening(assessmentId: string): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>("screening", {
    action: "abandon",
    assessmentId,
  });
}

/**
 * Asks the Clarification Engine to explain a term. `variableKey` is only a
 * retrieval hint (the SCORED variable the user is looking at) so a bare
 * "what does that mean?" still finds the right definition — it carries no
 * assessment identity and the engine cannot act on it.
 */
export function askClarification(
  question: string,
  variableKey?: string,
): Promise<ClarifyResponse> {
  return invoke<ClarifyResponse>("clarify", { question, variableKey });
}
