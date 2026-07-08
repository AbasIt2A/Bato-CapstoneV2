// Cross-encoder reranking stage for the General CKD Chatbot's retrieval
// pipeline (hardened-RAG spec §3, §12 step 3).
//
// The vector stage (retrieval.ts) over-fetches a wide candidate pool at a
// low similarity floor; THIS stage is the actual relevance gate. It scores
// each candidate against the user's question with Cohere Rerank v3.5 and
// keeps only candidates whose relevance_score clears RERANK_THRESHOLD,
// capped at RERANK_TOP_N.
//
// Degradation, never failure: if COHERE_API_KEY is unset or the Cohere call
// fails/times out, we fall back to cosine-similarity ordering — keep chunks
// at or above FALLBACK_SIMILARITY_THRESHOLD, best first, same top-N cap —
// and log a warning. rerankChunks never throws.
//
// Used ONLY by the general-chat Edge Function.

import type { RetrievedChunk } from "./retrieval.ts";

/** Max chunks that survive reranking and reach the generation context. */
export const RERANK_TOP_N = 4;

/**
 * Minimum Cohere relevance_score (0..1) a candidate must reach. Overridable
 * via the RERANK_THRESHOLD env var for tuning without a redeploy of code.
 */
export const RERANK_THRESHOLD = envNumber("RERANK_THRESHOLD", 0.30);

/**
 * Cosine-similarity floor used ONLY in the degraded (no-reranker) path.
 * Matches the empirically tuned band split for gemini-embedding-001:
 * evergreen CKD questions score ~0.60-0.64, off-topic ~0.43-0.45.
 */
export const FALLBACK_SIMILARITY_THRESHOLD = 0.60;

export const RERANK_MODEL = "rerank-v3.5";

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

/** Hard cap on the rerank round-trip before degrading to similarity order. */
export const RERANK_TIMEOUT_MS = 8000;

export interface RerankedChunk extends RetrievedChunk {
  /** Cohere relevance_score; absent when the fallback path was used. */
  rerank_score?: number;
}

function envNumber(name: string, fallback: number): number {
  try {
    const raw = Deno.env.get(name);
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback; // no env permission (offline tests)
  }
}

/** Text Cohere scores for a chunk: section heading (when known) + content. */
function rerankDocument(chunk: RetrievedChunk): string {
  const heading = chunk.heading_path?.trim() || chunk.title?.trim() || "";
  return heading ? `${heading}\n${chunk.content}` : chunk.content;
}

/** Degraded path: cosine-similarity ordering with a stricter floor. */
function fallbackBySimilarity(chunks: RetrievedChunk[]): RerankedChunk[] {
  return [...chunks]
    .filter((c) => c.similarity >= FALLBACK_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RERANK_TOP_N);
}

/**
 * Reranks vector-stage candidates against the user's question. Returns at
 * most RERANK_TOP_N chunks with relevance_score >= RERANK_THRESHOLD, most
 * relevant first. An empty result means nothing grounds this question and
 * the caller must deflect. Never throws.
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
): Promise<RerankedChunk[]> {
  if (chunks.length === 0) return [];

  let apiKey: string | undefined;
  try {
    apiKey = Deno.env.get("COHERE_API_KEY");
  } catch {
    apiKey = undefined;
  }
  if (!apiKey) {
    console.warn(
      "rerank: COHERE_API_KEY not set — degrading to cosine-similarity ordering",
    );
    return fallbackBySimilarity(chunks);
  }

  try {
    const response = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents: chunks.map(rerankDocument),
        top_n: Math.min(RERANK_TOP_N, chunks.length),
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cohere rerank HTTP ${response.status}: ${detail}`);
    }

    const data = await response.json();
    const results: unknown = data?.results;
    if (!Array.isArray(results)) {
      throw new Error("Cohere rerank returned no results array");
    }

    // Cohere returns results sorted by relevance_score descending; keep that
    // order, apply the threshold, and re-cap defensively.
    const kept: RerankedChunk[] = [];
    for (const r of results as {
      index?: number;
      relevance_score?: number;
    }[]) {
      const index = typeof r?.index === "number" ? r.index : -1;
      const score = typeof r?.relevance_score === "number"
        ? r.relevance_score
        : -1;
      const chunk = chunks[index];
      if (!chunk || score < RERANK_THRESHOLD) continue;
      kept.push({ ...chunk, rerank_score: score });
    }
    return kept.slice(0, RERANK_TOP_N);
  } catch (err) {
    console.warn(
      "rerank: Cohere call failed — degrading to cosine-similarity ordering:",
      err,
    );
    return fallbackBySimilarity(chunks);
  }
}
