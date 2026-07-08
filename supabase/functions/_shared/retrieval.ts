// pgvector retrieval for the General CKD Chatbot's grounded RAG pipeline
// (hardened-RAG spec §3, §12 steps 2-3).
//
// This is the RECALL stage, not the relevance gate. It over-fetches a wide
// candidate pool (RETRIEVAL_TOP_K) at a deliberately low similarity floor
// (VECTOR_SIMILARITY_FLOOR); rerank.ts decides what is actually relevant.
// Chunks are never appended to the system prompt — general-chat/index.ts
// injects them into the final user turn inside untrusted-data delimiters
// (see rag-content.ts).
//
// Used ONLY by the general-chat Edge Function.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedText } from "./embeddings.ts";

/**
 * Candidate pool size handed to the reranker. Wide on purpose: recall is
 * this stage's job, precision is the reranker's.
 */
export const RETRIEVAL_TOP_K = 20;

/**
 * Minimum cosine similarity (0..1) for a chunk to enter the candidate pool.
 * Deliberately below the old 0.7 relevance threshold — it only trims noise
 * (off-topic queries score ~0.43-0.45 against this corpus with
 * gemini-embedding-001) while letting borderline candidates reach the
 * reranker, which applies the real relevance gate (RERANK_THRESHOLD).
 * Overridable via the VECTOR_SIMILARITY_FLOOR env var.
 */
export const VECTOR_SIMILARITY_FLOOR = envNumber(
  "VECTOR_SIMILARITY_FLOOR",
  0.45,
);

export interface RetrievedChunk {
  id: string;
  source: string;
  title: string;
  content: string;
  topic_tags: string[];
  similarity: number;
  /** Section path within the source document, when the RPC provides it. */
  heading_path?: string | null;
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

/**
 * Top-K candidate chunks at or above the vector floor, best match first.
 * Empty array ⇒ nothing in the corpus is even loosely related; the caller
 * deflects. Throws on infrastructure failure (embedding or RPC) — the
 * caller maps that to a deflection, never a 500.
 */
export async function retrieveChunks(
  supabase: SupabaseClient,
  query: string,
): Promise<RetrievedChunk[]> {
  const embedding = await embedText({
    text: query,
    taskType: "RETRIEVAL_QUERY",
  });
  // Parameterized RPC — never string-built SQL.
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: VECTOR_SIMILARITY_FLOOR,
    match_count: RETRIEVAL_TOP_K,
  });
  if (error) throw new Error(`match_knowledge_chunks failed: ${error.message}`);

  // Defensive mapping: missing fields degrade to empty values, never break.
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    source: typeof row.source === "string" ? row.source : "",
    title: typeof row.title === "string" ? row.title : "",
    content: typeof row.content === "string" ? row.content : "",
    topic_tags: Array.isArray(row.topic_tags)
      ? row.topic_tags.filter((t): t is string => typeof t === "string")
      : [],
    similarity: typeof row.similarity === "number" ? row.similarity : 0,
    heading_path: typeof row.heading_path === "string"
      ? row.heading_path
      : null,
  }));
}
