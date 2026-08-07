// Cross-encoder reranking stage for the shared retrieval pipeline
// (hardened-RAG spec §3, §12 step 3).
//
// The vector stage (retrieval.ts) over-fetches a wide candidate pool at a
// low similarity floor; THIS stage is the actual relevance gate. It scores
// each candidate against the user's question with Cohere Rerank v3.5 and
// keeps only candidates whose relevance_score clears the scope's rerank
// threshold, capped at the scope's top-N.
//
// Degradation, never failure: if COHERE_API_KEY is unset or the Cohere call
// fails/times out, we fall back to cosine-similarity ordering — keep chunks
// at or above the scope's fallback floor, best first, same top-N cap — and
// log a warning. rerankChunks never throws.
//
// Shared by BOTH chatbots. Thresholds are per-scope (scopes.ts): the
// screening-clarification path runs stricter than general education.

import type { RetrievedChunk } from "./retrieval.ts";
import {
  type RetrievalScope,
  scopeProfile,
  SCOPE_PROFILES,
  type ScopeProfile,
} from "./scopes.ts";

/**
 * Max chunks that survive reranking on the general-education path.
 * @deprecated Read `scopeProfile(scope).rerankTopN` instead — retained
 * because the existing test suite asserts against it.
 */
export const RERANK_TOP_N = SCOPE_PROFILES.general_education.rerankTopN;

/**
 * Minimum Cohere relevance_score (0..1) a general-education candidate must
 * reach. Overridable via the RERANK_THRESHOLD env var for tuning without a
 * redeploy of code.
 * @deprecated Read `scopeProfile(scope).rerankThreshold` instead.
 */
export const RERANK_THRESHOLD =
  SCOPE_PROFILES.general_education.rerankThreshold;

/**
 * Cosine-similarity floor used ONLY in the degraded (no-reranker) path.
 * Matches the empirically tuned band split for gemini-embedding-001:
 * evergreen CKD questions score ~0.60-0.64, off-topic ~0.43-0.45.
 * @deprecated Read `scopeProfile(scope).fallbackSimilarity` instead.
 */
export const FALLBACK_SIMILARITY_THRESHOLD =
  SCOPE_PROFILES.general_education.fallbackSimilarity;

export const RERANK_MODEL = "rerank-v3.5";

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

/** Hard cap on the rerank round-trip before degrading to similarity order. */
export const RERANK_TIMEOUT_MS = 8000;

export interface RerankedChunk extends RetrievedChunk {
  /** Cohere relevance_score; absent when the fallback path was used. */
  rerank_score?: number;
}

/** Text Cohere scores for a chunk: section heading (when known) + content. */
function rerankDocument(chunk: RetrievedChunk): string {
  const heading = chunk.heading_path?.trim() || chunk.title?.trim() || "";
  return heading ? `${heading}\n${chunk.content}` : chunk.content;
}

/** Degraded path: cosine-similarity ordering with a stricter floor. */
function fallbackBySimilarity(
  chunks: RetrievedChunk[],
  profile: ScopeProfile,
): RerankedChunk[] {
  return [...chunks]
    .filter((c) => c.similarity >= profile.fallbackSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, profile.rerankTopN);
}

/**
 * Reranks vector-stage candidates against the user's question, using the
 * thresholds of `scope`. Returns at most that scope's top-N chunks clearing
 * its rerank threshold, most relevant first. An empty result means nothing
 * grounds this question and the caller must deflect. Never throws.
 *
 * `scope` defaults to general education so existing call sites and tests keep
 * their behaviour unchanged; the clarify path passes its scope explicitly.
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  scope: RetrievalScope = "general_education",
): Promise<RerankedChunk[]> {
  const profile = scopeProfile(scope);
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
    return fallbackBySimilarity(chunks, profile);
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
        top_n: Math.min(profile.rerankTopN, chunks.length),
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
    // order, apply the SCOPE'S threshold, and re-cap defensively.
    //
    // profile.*, never the module-level RERANK_THRESHOLD / RERANK_TOP_N
    // constants: those are general-education values kept only for the older
    // tests that assert against them (see their @deprecated notes in
    // scopes.ts). Using them here silently ran the clarification engine at
    // general-education strictness — 0.30 instead of 0.45, top-4 instead of
    // top-3 — inverting the precision-over-recall trade-off that scope
    // exists to make, right beside a validated instrument.
    //
    // The defect was invisible for as long as it existed because
    // COHERE_API_KEY was unset, so every request took fallbackBySimilarity()
    // below, which reads profile correctly. It surfaced within minutes of
    // enabling the key: a clarification query kept a chunk scoring 0.305,
    // which its own threshold should have rejected outright.
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
      if (!chunk || score < profile.rerankThreshold) continue;
      kept.push({ ...chunk, rerank_score: score });
    }
    return kept.slice(0, profile.rerankTopN);
  } catch (err) {
    console.warn(
      "rerank: Cohere call failed — degrading to cosine-similarity ordering:",
      err,
    );
    return fallbackBySimilarity(chunks, profile);
  }
}
