// pgvector retrieval for the shared grounded RAG pipeline
// (hardened-RAG spec §3, §12 steps 2-3).
//
// This is the RECALL stage, not the relevance gate. It over-fetches a wide
// candidate pool (the scope's topK) at a deliberately low similarity floor
// (the scope's vectorFloor); rerank.ts decides what is actually relevant.
// Chunks are never appended to the system prompt — the calling Edge Function
// injects them into the final user turn inside untrusted-data delimiters
// (see rag-content.ts).
//
// Shared by BOTH chatbots. The `scope` argument is mandatory and is passed
// through to the RPC, which filters on it structurally: there is no code path
// that retrieves without a scope, so neither subsystem can widen its own
// retrieval surface. Per-scope parameters live in scopes.ts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedText } from "./embeddings.ts";
import {
  type RetrievalScope,
  scopeProfile,
  SCOPE_PROFILES,
} from "./scopes.ts";

/**
 * Candidate pool size for the general CKD education scope.
 * @deprecated Read `scopeProfile(scope).topK` instead — retained because the
 * existing test suite asserts against it.
 */
export const RETRIEVAL_TOP_K = SCOPE_PROFILES.general_education.topK;

/**
 * Minimum cosine similarity (0..1) for a chunk to enter the general-education
 * candidate pool. Deliberately below the old 0.7 relevance threshold — it
 * only trims noise (off-topic queries score ~0.43-0.45 against this corpus
 * with gemini-embedding-001) while letting borderline candidates reach the
 * reranker, which applies the real relevance gate.
 * @deprecated Read `scopeProfile(scope).vectorFloor` instead.
 */
export const VECTOR_SIMILARITY_FLOOR =
  SCOPE_PROFILES.general_education.vectorFloor;

export interface RetrievedChunk {
  id: string;
  source: string;
  title: string;
  content: string;
  topic_tags: string[];
  similarity: number;
  /** Section path within the source document, when the RPC provides it. */
  heading_path?: string | null;
  /** Scopes carried by the chunk; used to verify no cross-scope leakage. */
  scopes: string[];
}

/**
 * Embeds a user query for retrieval.
 *
 * Exposed separately from retrieveChunks() so a caller that needs the query
 * vector for something else — the answer cache looks up by cosine distance
 * over this exact vector — can compute it once and hand it back in, rather
 * than embedding the same string twice per request. Same model, same task
 * type, so a cache probe and the retrieval it might replace are guaranteed to
 * be measured in the same space.
 */
export function embedQuery(query: string): Promise<number[]> {
  return embedText({ text: query, taskType: "RETRIEVAL_QUERY" });
}

/**
 * Embeds a user query for the ANSWER CACHE's similarity tier.
 *
 * A separate vector from embedQuery(), under SEMANTIC_SIMILARITY rather than
 * RETRIEVAL_QUERY, because the two answer different questions: "which
 * passages match this query" versus "is this the same question as that one".
 * They are not interchangeable, and mixing them would compare vectors from
 * two different geometries.
 *
 * The extra API call is affordable — embeddings sit on a separate, far larger
 * quota than generation — and callers issue both in parallel, so it costs no
 * additional wall-clock latency.
 */
export function embedForCache(query: string): Promise<number[]> {
  return embedText({ text: query, taskType: "SEMANTIC_SIMILARITY" });
}

/**
 * Top-K candidate chunks within `scope`, at or above that scope's vector
 * floor, best match first. Empty array ⇒ nothing in the scoped corpus is even
 * loosely related; the caller deflects. Throws on infrastructure failure
 * (embedding or RPC) — the caller maps that to a deflection, never a 500.
 *
 * `precomputedEmbedding` must be the embedding of `query` under
 * embedQuery(); passing a vector for different text silently retrieves for
 * that other text instead. When omitted, the query is embedded here.
 */
export async function retrieveChunks(
  supabase: SupabaseClient,
  query: string,
  scope: RetrievalScope,
  precomputedEmbedding?: number[],
): Promise<RetrievedChunk[]> {
  const profile = scopeProfile(scope);
  const embedding = precomputedEmbedding ?? await embedQuery(query);
  // Parameterized RPC — never string-built SQL. match_scope is filtered
  // inside the query; an unrecognised value matches nothing (fail-closed).
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: profile.vectorFloor,
    match_count: profile.topK,
    match_scope: scope,
  });
  if (error) throw new Error(`match_knowledge_chunks failed: ${error.message}`);

  // Defensive mapping: missing fields degrade to empty values, never break.
  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
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
    scopes: Array.isArray(row.scopes)
      ? row.scopes.filter((s): s is string => typeof s === "string")
      : [],
  }));

  // Belt-and-braces scope check. The RPC already filters structurally, so
  // this can only fire if the function were altered out from under the
  // application — which is exactly the regression worth catching loudly
  // rather than serving into a live assessment.
  const leaked = rows.filter((r) => !r.scopes.includes(scope));
  if (leaked.length > 0) {
    console.error(
      `retrieval: ${leaked.length} chunk(s) returned outside scope "${scope}" ` +
        `— dropping. Check match_knowledge_chunks.`,
    );
    return rows.filter((r) => r.scopes.includes(scope));
  }
  return rows;
}
