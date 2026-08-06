// Client for the Risk Assessment backend. It talks to TWO backends, and the
// split is the architecture, not an accident:
//
//   SCORING  → the ORIGINAL capstone Supabase project (`screening` Edge
//              Function). The state machine and the SCORED scoring rules stay
//              there, deterministic and untouched; this build never
//              reimplements scoring. Auth mirrors the capstone frontend: an
//              anonymous supabase-js session, attached automatically to
//              functions.invoke().
//
//   CLARIFY  → THIS project's `clarify` Edge Function (see
//              supabase/functions/clarify/index.ts), which grounds its answer
//              in the same corpus, embedding model, reranker and output guard
//              as the General CKD Chatbot, differing only by retrieval scope.
//              Plain fetch with the public anon key, exactly like
//              src/api.ts — no session, because there is no user state to
//              carry.
//
// That is what makes the clarification branch structurally incapable of
// touching a SCORED variable: it is not merely forbidden from writing one, it
// runs against a project that has no assessment tables at all, and is handed
// no assessment ID to write against.

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

export interface ClarifySource {
  source: string;
  title: string;
  heading_path: string | null;
}

/**
 * Note what is NOT here: no step, no score, no classification, no session.
 *
 * The clarification engine cannot advance, rewind or alter the assessment, so
 * it returns nothing the caller could mistake for assessment state. The
 * caller already holds the current step and simply re-displays it — that IS
 * "control returns to the Rule-Based Screening Controller at the same
 * variable, unchanged".
 */
export interface ClarifyResponse {
  reply: string;
  sources: ClarifySource[];
  deflected: boolean;
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

// --- Clarification: this project's shared RAG pipeline -------------------

const RAG_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const RAG_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Mirrors MAX_QUESTION_LENGTH in supabase/functions/clarify/index.ts. */
export const MAX_CLARIFY_LENGTH = 500;

/**
 * Ask the LLM Clarification Engine to explain a term, mid-assessment.
 *
 * `variableKey` is the current step's key, sent only as a retrieval hint so a
 * bare "what does that mean?" still finds the right definition. It cannot
 * widen retrieval scope — that is fixed server-side and enforced again inside
 * the SQL function.
 *
 * Never pass an assessment ID here. The engine has no use for one, and
 * keeping it out is what makes "this branch cannot record or modify a SCORED
 * variable" a property of the wiring rather than a promise in a prompt.
 */
export async function askClarification(
  question: string,
  variableKey?: string,
): Promise<ClarifyResponse> {
  if (!RAG_URL || !RAG_KEY) {
    throw new Error(
      "The clarification assistant is not configured — fill in " +
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env " +
        "(see frontend/.env.example).",
    );
  }

  const res = await fetch(`${RAG_URL}/functions/v1/clarify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAG_KEY}`,
      apikey: RAG_KEY,
    },
    body: JSON.stringify({ question, variableKey }),
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `request failed with status ${res.status}`;
    throw new Error(detail);
  }
  return data as ClarifyResponse;
}
