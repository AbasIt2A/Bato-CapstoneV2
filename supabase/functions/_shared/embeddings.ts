// Gemini embedding client for the General CKD Chatbot's retrieval pipeline.
// Server-side only — the API key lives in function secrets and must never
// reach the browser.
//
// Shared by the one-time ingestion script (owned by a separate agent) and
// this Edge Function's query path, so document embeddings and query
// embeddings are always produced by the same model and dimension.
//
// Model note: gemini-embedding-001 defaults to 3072 dims but supports
// Matryoshka truncation, so we request 768 to match the approved
// vector(768) schema. Truncated outputs are not unit-length, so embedText()
// re-normalizes them (per Google's guidance); cosine similarity is
// scale-invariant either way.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const EMBEDDING_MODEL = "gemini-embedding-001";

/** Requested output dimension. MUST match knowledge_chunks.embedding
 *  (vector(768)). Changing the model or dimension means changing this
 *  constant AND the migration together — and re-ingesting. */
export const EMBEDDING_DIMENSION = 768;

// Gemini distinguishes the embedding of a stored passage from the embedding
// of a search query; using the matched task types improves retrieval quality.
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedText(options: {
  text: string;
  taskType: EmbeddingTaskType;
  /** Optional short label; Gemini uses it only for RETRIEVAL_DOCUMENT. */
  title?: string;
}): Promise<number[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: options.text }] },
    taskType: options.taskType,
    outputDimensionality: EMBEDDING_DIMENSION,
  };
  if (options.taskType === "RETRIEVAL_DOCUMENT" && options.title) {
    body.title = options.title;
  }

  const request = () =>
    fetch(`${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

  let response = await request();
  if (response.status === 429 || response.status >= 500) {
    // One retry for transient overload.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await request();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini embedding error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const values: unknown = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Gemini embedding returned ${
        Array.isArray(values) ? values.length : "no"
      } dimensions (expected ${EMBEDDING_DIMENSION})`,
    );
  }
  // Truncated (non-3072) outputs are not unit-normalized; normalize so the
  // stored vectors are well-behaved regardless of distance operator.
  const vec = values as number[];
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  return vec.map((v) => v / norm);
}
