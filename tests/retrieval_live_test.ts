// OPTIONAL live integration test (spec §14.1) — foundational + per-topic-area
// retrieval-and-rerank coverage against the real Gemini embedding API, the
// real Supabase pgvector RPC, and the real (or gracefully-degraded)
// reranker.
//
// Every Deno.test below is `ignore: !liveEnabled`, so the default offline
// suite (`deno test tests/`, i.e. the `test` task in deno.json — no
// --allow-net, no live env vars) never touches the network: these tests are
// reported as skipped, not passed or failed.
//
// To actually run this file, set GEMINI_API_KEY, SUPABASE_URL, and
// SUPABASE_SERVICE_ROLE_KEY and run:
//   deno test --allow-net --allow-env --allow-read tests/retrieval_live_test.ts
//
// Implementation note: the CONTRACT for retrieval.ts exposes only
// RETRIEVAL_TOP_K, VECTOR_SIMILARITY_FLOOR, and the RetrievedChunk shape —
// no retrieval *function* is part of the contract this suite was written
// against. So this file performs the embed + pgvector-RPC round trip itself
// via fetch, rather than guessing at an unlisted export. It assumes the
// `match_knowledge_chunks(query_embedding, match_threshold, match_count)`
// RPC and gemini-embedding-001 @ 768 dims, matching this project's approved
// Phase 0 decisions. If the real schema differs, only this optional file
// needs adjusting — it never affects the offline suite.

import { assertEquals } from "jsr:@std/assert@1";
import {
  RETRIEVAL_TOP_K,
  VECTOR_SIMILARITY_FLOOR,
  type RetrievedChunk,
} from "../supabase/functions/_shared/retrieval.ts";
import { rerankChunks } from "../supabase/functions/_shared/rerank.ts";
import { isApprovedSource } from "../supabase/functions/_shared/sources.ts";

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

const GEMINI_API_KEY = readEnv("GEMINI_API_KEY");
const SUPABASE_URL = readEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");

const liveEnabled = !!(GEMINI_API_KEY && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSION = 768;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function embedQuery(text: string): Promise<number[]> {
  const response = await fetch(
    `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini embedding error ${response.status}`);
  }
  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error("Gemini embedding returned no values");
  }
  return values as number[];
}

async function retrieveTopK(query: string): Promise<RetrievedChunk[]> {
  const embedding = await embedQuery(query);
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/match_knowledge_chunks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        query_embedding: JSON.stringify(embedding),
        match_threshold: VECTOR_SIMILARITY_FLOOR,
        match_count: RETRIEVAL_TOP_K,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`match_knowledge_chunks RPC error ${response.status}`);
  }
  const rows = (await response.json()) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    source: String(row.source ?? ""),
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    topic_tags: Array.isArray(row.topic_tags) ? (row.topic_tags as string[]) : [],
    similarity: typeof row.similarity === "number" ? row.similarity : 0,
    heading_path: typeof row.heading_path === "string" ? row.heading_path : null,
  }));
}

/** Spec §14.1 battery: extra scrutiny on the two foundational questions,
 *  plus one representative query per remaining topic area. */
const LIVE_QUERIES: { label: string; query: string }[] = [
  { label: "foundational: what is CKD", query: "What is chronic kidney disease?" },
  { label: "foundational: stages", query: "What are the stages of CKD?" },
  { label: "symptoms", query: "What are the symptoms of chronic kidney disease?" },
  { label: "diet", query: "What foods should I avoid if I have kidney disease?" },
  { label: "treatment/dialysis", query: "How does dialysis work for CKD patients?" },
  {
    label: "Philippines context",
    query: "Does PhilHealth cover dialysis costs in the Philippines?",
  },
  { label: "prevention", query: "How can I prevent chronic kidney disease?" },
];

for (const { label, query } of LIVE_QUERIES) {
  Deno.test({
    name: `live retrieval: ${label} ("${query}") retrieves >=1 reranked chunk from an approved source`,
    ignore: !liveEnabled,
    fn: async () => {
      const candidates = await retrieveTopK(query);
      const reranked = await rerankChunks(query, candidates);
      assertEquals(
        reranked.length >= 1,
        true,
        `expected at least one chunk to clear reranking for "${query}"`,
      );
      for (const chunk of reranked) {
        assertEquals(isApprovedSource(chunk.source), true, `${label}: ${chunk.source}`);
      }
    },
  });
}

Deno.test({
  name: "live config sanity: retrieval constants stay within documented bounds",
  ignore: !liveEnabled,
  fn: () => {
    assertEquals(RETRIEVAL_TOP_K, 20);
    assertEquals(VECTOR_SIMILARITY_FLOOR > 0 && VECTOR_SIMILARITY_FLOOR < 1, true);
  },
});
