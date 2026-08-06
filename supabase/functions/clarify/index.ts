// LLM Clarification Engine — Edge Function.
//
// The Risk Assessment Chatbot's retrieval side-branch. When a user pauses
// mid-questionnaire to ask what a term means, the Rule-Based Screening
// Controller delegates here; this function returns a plain-language
// explanation grounded in the approved corpus, and control returns to the
// controller at the same variable, untouched.
//
// ===== WHY THIS FUNCTION LIVES HERE =====
//
// Clarification previously ran in the original capstone project against
// separate infrastructure, which contradicted the design claim that the two
// subsystems are "separated by scope metadata within a single pipeline
// rather than by separate infrastructures". It now runs on the same corpus,
// the same embedding model, the same reranker and the same output guard as
// the General CKD Chatbot, differing ONLY by retrieval scope and thresholds.
//
// Scoring did NOT move and must not: the SCORED state machine and scoring
// engine stay in the capstone project, deterministic and untouched. That
// split is deliberate. The retrieval pipeline is shared; the scoring path is
// isolated.
//
// ===== THE STRUCTURAL GUARANTEE =====
//
// "This branch can neither record nor modify the value of any SCORED
// variable." That guarantee is not a prompt instruction here — it is the
// absence of a mechanism:
//
//   * this function accepts NO assessment ID and NO answer value;
//   * it holds NO reference to the assessment state machine or its project;
//   * it performs NO writes of any kind;
//   * its response carries prose and citations only — no step, no score,
//     no classification, nothing the caller could mistake for an answer.
//
// The client keeps its own current step and re-displays it after the
// exchange. There is therefore no code path, correct or malicious, by which
// a clarification can alter a recorded variable.
//
// Pipeline (mirrors general-chat, stricter thresholds):
//   (1) input gate — scope + injection classification;
//   (2)-(3) embed, pgvector top-K within screening_clarification ONLY;
//   (4) rerank to top-N above the clarification threshold;
//   (5) none pass ⇒ approved clarification deflection;
//   (6) else generate with chunks as UNTRUSTED DATA, citing each source;
//   (7) diagnostic-language filter — never let "you have CKD" reach a user
//       mid-assessment, where it would read as this branch scoring them;
//   (8) output guard (injection fallout / groundedness) before the reply
//       reaches the user.
//
// Every infrastructure failure degrades to the deflection with a server-side
// log — never a raw 500, and never a stall mid-assessment.
//
// POST { question: string, variableKey?: string }
//   → { reply, sources, deflected }

import { classifyQuery, type GateVerdict } from "../_shared/gate.ts";
import { retrieveChunks, type RetrievedChunk } from "../_shared/retrieval.ts";
import { rerankChunks } from "../_shared/rerank.ts";
import { buildGroundedUserMessage } from "../_shared/rag-content.ts";
import { generateReply } from "../_shared/gemini.ts";
import { checkDraftAnswer } from "../_shared/output-guard.ts";
import { filterAssistantReply } from "../_shared/topic-filter.ts";
import {
  CLARIFICATION_DEFLECTION_MESSAGE,
  CLARIFICATION_SYSTEM_PROMPT,
} from "../_shared/prompts.ts";
import {
  corsHeaders,
  createServiceClient,
  jsonResponse,
} from "../_shared/supabase.ts";
import type { RetrievalScope } from "../_shared/scopes.ts";

/** Hard-locked. Never taken from the request — the client cannot widen it. */
const SCOPE: RetrievalScope = "screening_clarification";

// Shorter than general-chat's 2000: this is a "what does X mean?" aside, not
// a free-form conversation. A long body here is a misuse of the endpoint.
const MAX_QUESTION_LENGTH = 500;

const MAX_VARIABLE_KEY_LENGTH = 40;

interface SourceCitation {
  source: string;
  title: string;
  heading_path: string | null;
}

interface ClarifyResponse {
  reply: string;
  sources: SourceCitation[];
  deflected: boolean;
}

function deflect(): Response {
  const body: ClarifyResponse = {
    reply: CLARIFICATION_DEFLECTION_MESSAGE,
    sources: [],
    deflected: true,
  };
  return jsonResponse(body);
}

/**
 * Optional retrieval hint naming the variable the user is on, so a bare
 * "what does that mean?" still retrieves the right definition.
 *
 * Client-supplied and therefore untrusted, but harmless: it only ever widens
 * the *text* of the embedding query, never the scope, which is fixed above
 * and enforced again inside the RPC. A spoofed key can at worst retrieve a
 * different in-scope clarification passage. Sanitised to word characters so
 * it cannot smuggle delimiters or instructions into the embedded string.
 */
function sanitizeVariableKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .slice(0, MAX_VARIABLE_KEY_LENGTH)
    .replace(/[^A-Za-z0-9 _-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { question?: unknown; variableKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return jsonResponse({ error: "question is required" }, 400);
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse({ error: "Question is too long" }, 400);
  }
  const variableKey = sanitizeVariableKey(body.variableKey);

  try {
    const supabase = createServiceClient();

    // (1) Input gate — scope + injection classification. classifyQuery()
    // never throws (fail-open on API error), but a defensive catch keeps
    // this route from ever surfacing a raw 500.
    let verdict: GateVerdict;
    try {
      // Scope-matched gate. The general-education prompt rejects "other
      // diseases", which is most of the nine SCORED variables — see
      // CLARIFY_GATE_SYSTEM_PROMPT in gate.ts.
      verdict = await classifyQuery(question, SCOPE);
    } catch (err) {
      console.warn("clarify: gate threw unexpectedly — failing open:", err);
      verdict = {
        in_scope: true,
        injection_detected: false,
        reason: "gate-error",
      };
    }
    if (!verdict.in_scope || verdict.injection_detected) {
      console.warn("clarify: gate blocked question:", verdict.reason);
      return deflect();
    }

    // (2)-(3) Retrieve within the clarification scope ONLY. The variable
    // hint joins the embedding query but never the prompt.
    const retrievalQuery = variableKey
      ? `${variableKey}: ${question}`
      : question;
    let candidates: RetrievedChunk[];
    try {
      candidates = await retrieveChunks(supabase, retrievalQuery, SCOPE);
    } catch (err) {
      console.error("clarify: retrieval failed — deflecting:", err);
      return deflect();
    }

    // (4) Rerank at the clarification threshold — stricter than general
    // education by design (see scopes.ts).
    const reranked = await rerankChunks(question, candidates, SCOPE);
    if (reranked.length === 0) {
      console.warn(
        "clarify: no chunks cleared the clarification threshold — deflecting",
      );
      return deflect();
    }

    // (5) Generate. The system prompt is the ONLY trusted instruction
    // region; the retrieved chunks and the user's question travel together,
    // both neutralized, as the single untrusted user turn.
    let draft: string;
    try {
      draft = await generateReply({
        systemPrompt: CLARIFICATION_SYSTEM_PROMPT,
        message: buildGroundedUserMessage(question, reranked),
      });
    } catch (err) {
      console.error("clarify: generation failed — deflecting:", err);
      return deflect();
    }

    // The model may decline on its own by emitting the approved wording
    // verbatim (the system prompt quotes it for exactly that purpose). Report
    // that as a deflection rather than as an answer: otherwise the response
    // carries deflected:false plus source chips for chunks the reply never
    // used, and the UI renders a refusal styled as a normal cited answer.
    if (draft.trim().replace(/\s+/g, " ") ===
        CLARIFICATION_DEFLECTION_MESSAGE.replace(/\s+/g, " ")) {
      console.warn("clarify: model declined on its own — reporting as deflection");
      return deflect();
    }

    // (7) Diagnostic-language filter. Distinct from the output guard below:
    // this catches "you have CKD" reaching a user mid-assessment, which the
    // groundedness/injection guard does not check for at all.
    const filtered = filterAssistantReply(draft);
    if (!filtered.ok) {
      console.warn("clarify: diagnostic-language filter blocked reply:", filtered.blockedReason);
      return deflect();
    }

    // (8) Output safety check — cheap heuristics, no model call. Judged
    // against the sources actually retrieved this turn.
    const guard = checkDraftAnswer(
      draft,
      CLARIFICATION_SYSTEM_PROMPT,
      reranked.map((c) => c.source),
    );
    if (!guard.safe) {
      console.warn("clarify: output guard blocked reply:", guard.reason);
      return deflect();
    }

    const sources: SourceCitation[] = reranked.map((c) => ({
      source: c.source,
      title: c.title,
      heading_path: c.heading_path ?? null,
    }));

    const response: ClarifyResponse = {
      reply: draft,
      sources,
      deflected: false,
    };
    return jsonResponse(response);
  } catch (err) {
    // Last-resort safety net: any unexpected failure still degrades to the
    // deflection. A user mid-assessment must never be left stalled.
    console.error("clarify: unexpected error — deflecting:", err);
    return deflect();
  }
});
