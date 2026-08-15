// Gemini API client for the General CKD Chatbot's grounded generation turn.
// Server-side only — the API key lives in function secrets and must never
// reach the browser.
//
// The General CKD Chatbot is single-turn and stateless (no chat-session
// persistence in this standalone build): the caller always sends the
// hardened system prompt as the only trusted instruction region, plus one
// user-role message containing the untrusted grounded content built by
// rag-content.ts's buildGroundedUserMessage(). There is no history array —
// never concatenate prior turns, user text, or retrieved text into the
// system prompt.

import type { RetrievalScope } from "./scopes.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * General CKD Chatbot's generation model; override with the GEMINI_MODEL env
 * var.
 *
 * NOT `gemini-2.5-flash`: Google has closed the 2.5 series to new API keys
 * ("no longer available to new users", HTTP 404). Unlike the gate — which
 * fails open — a 404 here throws, and the Edge Functions turn that into the
 * approved deflection, so a stale model name shows up as "the chatbot
 * refuses every question" rather than as an error.
 *
 * Benchmarked 2026-08-07 on the real grounded prompt (4.7KB system + 3KB
 * retrieved chunks), answering "What is CKD?":
 *
 *   gemini-3.5-flash-lite    ~1.0s     ← chosen
 *   gemini-3.1-flash-lite    ~1.5s
 *   gemini-3.5-flash         ~4.0s
 *   gemini-3.6-flash        ~22-24s    unusable: exceeds GENERATION_TIMEOUT_MS
 *
 * All four cited correctly. Spot-checking flash-lite against the larger
 * flash on harder prompts (PhilHealth coverage, renal diet, "can herbal
 * supplements cure stage 5 CKD") produced equivalent answers — same
 * citations, same refusal to endorse supplements, same deferral to a
 * professional — at roughly half the latency. The generation step only has
 * to restate retrieved chunks in plain language, so the larger model's extra
 * capability is not what this task is bottlenecked on.
 */
export const GENERATION_MODEL_DEFAULT = "gemini-3.5-flash-lite";

/**
 * LLM Clarification Engine's generation model; override with the
 * CLARIFY_GEMINI_MODEL env var.
 *
 * A DIFFERENT model from the general chatbot's, and the difference is the
 * point rather than a quality judgement. Google's free tier meters
 * `generateContent` per project PER MODEL (20/day), so two chatbots sharing
 * one model name share one daily allowance and starve each other; two names
 * are two independent allowances at no cost and no loss of capability.
 *
 * `gemini-3.1-flash-lite` measured ~1.5s against `gemini-3.5-flash-lite`'s
 * ~1.0s on the same grounded prompt, both citing correctly. Half a second is
 * a fair price for doubling the day's capacity, and clarification is the
 * lower-volume path of the two — it fires only when a user pauses
 * mid-questionnaire to ask what a term means.
 *
 * Both models are held at the SAME temperature and prompt by their callers;
 * nothing about the answer contract varies with this setting. If you change
 * it, change it to a model that is not `GENERATION_MODEL_DEFAULT` and not
 * `GATE_MODEL_DEFAULT` (gate.ts), or the buckets silently merge again.
 */
export const CLARIFY_GENERATION_MODEL_DEFAULT = "gemini-3.1-flash-lite";

/**
 * The generation model for `scope`, env-overridable per scope.
 *
 * Callers pass a scope rather than a model name so that the "one model per
 * scope" invariant lives in one place. Note that Supabase function secrets
 * are project-wide: a single GEMINI_MODEL secret would otherwise apply to
 * both functions and re-collapse the split, which is why there are two
 * distinct variable names.
 */
export function generationModelFor(scope: RetrievalScope): string {
  const envName = scope === "screening_clarification"
    ? "CLARIFY_GEMINI_MODEL"
    : "GEMINI_MODEL";
  const fallback = scope === "screening_clarification"
    ? CLARIFY_GENERATION_MODEL_DEFAULT
    : GENERATION_MODEL_DEFAULT;
  try {
    return Deno.env.get(envName) ?? fallback;
  } catch {
    return fallback; // no env permission (offline tests)
  }
}

/** Hard cap on the generation round-trip before failing (see gate.ts's
 *  GATE_TIMEOUT_MS / rerank.ts's RERANK_TIMEOUT_MS for the same pattern). */
export const GENERATION_TIMEOUT_MS = 15000;

/**
 * Gemini 3.x deliberates before answering by default — ~26s on a trivial
 * prompt, which blows straight past GENERATION_TIMEOUT_MS and aborts. These
 * answers are short, plain-language, and fully grounded in retrieved chunks,
 * so extended reasoning buys nothing: held at the lowest setting, measured
 * ~2.4s versus ~26s unset. (`thinkingBudget: 0` is rejected as an invalid
 * argument on these models; `thinkingLevel` is the supported control.)
 */
const GENERATION_THINKING_LEVEL = "low";

/** Sampling temperature when the caller does not specify one. */
const DEFAULT_TEMPERATURE = 0.3;

/**
 * Output budget when the caller does not specify one.
 *
 * THINKING TOKENS COME OUT OF THIS SAME BUDGET on the 3.x models. A measured
 * reply to "how bad is obesity for my kidneys" spent 785 tokens thinking and
 * 102 answering — so at the previous 1024 the answer had roughly 200 tokens
 * of room, and a slightly longer deliberation truncated it mid-sentence.
 *
 * That was always a defect; it became a visible one when replies gained a
 * required SOURCES line (citations.ts), because a truncated reply loses the
 * line and is then treated as unattributed and deflected. 2048 leaves the
 * answer about a thousand tokens after a typical deliberation. It costs
 * nothing on the free tier, which meters REQUESTS per day, not tokens.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export async function generateReply(options: {
  /** The ONLY trusted instruction region. */
  systemPrompt: string;
  /** The single untrusted user turn (retrieved chunks + user question). */
  message: string;
  maxOutputTokens?: number;
  /**
   * Sampling temperature. Defaults to 0.3, which suits the General CKD
   * Chatbot's free-form phrasing. The Clarification Engine passes 0: at 0.3
   * it intermittently talked itself into declining a perfectly valid
   * screening question (measured 1 refusal in 4 runs on the same input),
   * which mid-assessment reads as the tool being broken.
   */
  temperature?: number;
  /**
   * Selects the generation model (see generationModelFor). Defaults to
   * general education so existing callers and tests are unchanged.
   */
  scope?: RetrievalScope;
}): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = generationModelFor(options.scope ?? "general_education");

  const request = () =>
    fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: options.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: options.message }] }],
        generationConfig: {
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: GENERATION_THINKING_LEVEL },
        },
      }),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });

  // Two attempts. Retried on transient overload (429/5xx) AND on a 200 that
  // carries no usable text — the model intermittently returns
  // finishReason: MALFORMED_RESPONSE with empty parts. That is a successful
  // HTTP call, so the old status-only retry ignored it and threw, and the
  // Edge Functions turn a generation throw into the approved deflection.
  // Measured on the clarification path before this retry existed: one
  // spurious refusal in roughly every four identical requests, on both
  // chatbots, with nothing in the reply to distinguish it from a real
  // scope decision.
  let lastFailure = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const response = await request();

    if (response.status === 429 || response.status >= 500) {
      lastFailure = `Gemini API error ${response.status}`;
      continue;
    }
    if (!response.ok) {
      // 4xx other than 429 is a request-shaped problem; retrying is futile.
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini API error ${response.status}: ${detail}`);
    }

    const data = await response.json();
    const text: unknown = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim();

    const finishReason: string = data?.candidates?.[0]?.finishReason ?? "";

    // A reply cut off at the token ceiling is not a usable reply: it ends
    // mid-sentence and, on the general-chat path, has lost the SOURCES line
    // that carries its attribution. Retry it like any other transient
    // failure rather than shipping half an answer.
    if (finishReason === "MAX_TOKENS") {
      lastFailure = "Gemini truncated the reply (finishReason: MAX_TOKENS)";
      continue;
    }

    if (typeof text === "string" && text.length > 0) return text;

    // Covers malformed responses, safety blocks and empty candidates
    // without exposing internals.
    lastFailure = `Gemini returned no text (finishReason: ${
      finishReason || "unknown"
    })`;
  }

  throw new Error(lastFailure);
}
