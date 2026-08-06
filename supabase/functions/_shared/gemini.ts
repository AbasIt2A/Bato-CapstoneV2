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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Generation model; override with the GEMINI_MODEL env var.
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
}): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = Deno.env.get("GEMINI_MODEL") ?? GENERATION_MODEL_DEFAULT;

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
          maxOutputTokens: options.maxOutputTokens ?? 1024,
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

    if (typeof text === "string" && text.length > 0) return text;

    // Covers malformed responses, safety blocks and empty candidates
    // without exposing internals.
    lastFailure = `Gemini returned no text (finishReason: ${
      data?.candidates?.[0]?.finishReason ?? "unknown"
    })`;
  }

  throw new Error(lastFailure);
}
