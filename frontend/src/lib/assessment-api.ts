// Client for the Risk Assessment backend. The screening state machine, the
// SCORED scoring rules, and the clarification assistant all live in the
// ORIGINAL capstone Supabase project (deployed Edge Functions `screening`
// and `clarify`) — this build reuses them as-is and never reimplements the
// scoring. Auth mirrors the capstone frontend: an anonymous supabase-js
// session, attached automatically to functions.invoke().

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export interface ClarifyResponse {
  sessionId: string;
  reply: string;
  step: StepPayload;
}

const ASSESSMENT_URL = import.meta.env.VITE_ASSESSMENT_SUPABASE_URL as
  | string
  | undefined;
const ASSESSMENT_KEY = import.meta.env.VITE_ASSESSMENT_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!ASSESSMENT_URL || !ASSESSMENT_KEY) {
    throw new Error(
      "The Risk Assessment backend is not configured — fill in " +
        "VITE_ASSESSMENT_SUPABASE_URL and VITE_ASSESSMENT_SUPABASE_PUBLISHABLE_KEY " +
        "in frontend/.env (see frontend/.env.example).",
    );
  }
  client ??= createClient(ASSESSMENT_URL, ASSESSMENT_KEY);
  return client;
}

async function ensureSession(): Promise<void> {
  const supabase = getClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      /disabled/i.test(error.message)
        ? "Anonymous sign-ins are disabled on the assessment project. " +
            "Enable them in Supabase Dashboard → Authentication → " +
            "Sign In / Providers → Allow anonymous sign-ins."
        : error.message,
    );
  }
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = getClient();
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

export function askClarification(
  assessmentId: string,
  question: string,
  sessionId: string | null,
): Promise<ClarifyResponse> {
  return invoke<ClarifyResponse>("clarify", {
    assessmentId,
    question,
    sessionId,
  });
}
