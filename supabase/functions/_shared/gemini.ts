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

/** Generation model; override with the GEMINI_MODEL env var. */
export const GENERATION_MODEL_DEFAULT = "gemini-2.5-flash";

export async function generateReply(options: {
  /** The ONLY trusted instruction region. */
  systemPrompt: string;
  /** The single untrusted user turn (retrieved chunks + user question). */
  message: string;
  maxOutputTokens?: number;
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
          temperature: 0.3,
          maxOutputTokens: options.maxOutputTokens ?? 1024,
        },
      }),
    });

  let response = await request();
  if (response.status === 429 || response.status >= 500) {
    // One retry for transient overload (e.g. 503 "high demand").
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await request();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const text: unknown = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  if (typeof text !== "string" || text.length === 0) {
    // Covers safety blocks and empty candidates without exposing internals.
    throw new Error(
      `Gemini returned no text (finishReason: ${
        data?.candidates?.[0]?.finishReason ?? "unknown"
      })`,
    );
  }
  return text;
}
