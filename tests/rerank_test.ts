// Reranking-stage tests (contract: rerank.ts). Offline-first: every test
// explicitly ensures COHERE_API_KEY is unset unless it is specifically
// testing the Cohere-shaped path (in which case it sets a fake key AND
// stubs globalThis.fetch, restoring both in a finally block). No test in
// this file makes a real network call.
//
// Run with: deno test --allow-read --allow-env tests/rerank_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  FALLBACK_SIMILARITY_THRESHOLD,
  RERANK_MODEL,
  RERANK_THRESHOLD,
  RERANK_TOP_N,
  rerankChunks,
} from "../supabase/functions/_shared/rerank.ts";
import type { RetrievedChunk } from "../supabase/functions/_shared/retrieval.ts";

function chunk(overrides: Partial<RetrievedChunk> & { id: string }): RetrievedChunk {
  return {
    source: "NIDDK",
    title: "CKD basics",
    content: "Chronic kidney disease means the kidneys are damaged.",
    topic_tags: ["basics"],
    similarity: 0.5,
    heading_path: null,
    scopes: ["general_education"],
    ...overrides,
  };
}

/** Reads then clears COHERE_API_KEY; returns a restorer to call in `finally`. */
function withoutCohereKey(): () => void {
  let original: string | undefined;
  try {
    original = Deno.env.get("COHERE_API_KEY");
    Deno.env.delete("COHERE_API_KEY");
  } catch {
    // No --allow-env in this run: rerankChunks treats a missing permission
    // the same as a missing key, so there is nothing further to restore.
    return () => {};
  }
  return () => {
    if (original !== undefined) Deno.env.set("COHERE_API_KEY", original);
  };
}

Deno.test("rerank config: constants match the contract", () => {
  assertEquals(RERANK_TOP_N, 4);
  assertEquals(RERANK_THRESHOLD, 0.30);
  assertEquals(FALLBACK_SIMILARITY_THRESHOLD, 0.60);
  assertEquals(RERANK_MODEL, "rerank-v3.5");
});

Deno.test("rerankChunks: empty input yields empty output, never throws", async () => {
  const restore = withoutCohereKey();
  try {
    const result = await rerankChunks("What is CKD?", []);
    assertEquals(result, []);
  } finally {
    restore();
  }
});

Deno.test("rerankChunks: fallback keeps only chunks >= 0.60, sorted desc, capped at top-N", async () => {
  const restore = withoutCohereKey();
  try {
    const chunks: RetrievedChunk[] = [
      chunk({ id: "a", similarity: 0.95 }),
      chunk({ id: "b", similarity: 0.50 }), // below the fallback floor — dropped
      chunk({ id: "c", similarity: 0.60 }), // exactly at the floor — qualifies, but capped out
      chunk({ id: "d", similarity: 0.80 }),
      chunk({ id: "e", similarity: 0.70 }),
      chunk({ id: "f", similarity: 0.65 }),
    ];
    const result = await rerankChunks("What is CKD?", chunks);
    assertEquals(result.map((r) => r.id), ["a", "d", "e", "f"]);
    for (let i = 1; i < result.length; i++) {
      assertEquals(
        result[i - 1].similarity >= result[i].similarity,
        true,
        "results must be sorted by similarity, descending",
      );
    }
  } finally {
    restore();
  }
});

Deno.test("rerankChunks: fallback floor boundary — 0.60 kept, 0.59 dropped", async () => {
  const restore = withoutCohereKey();
  try {
    const result = await rerankChunks("What is CKD?", [
      chunk({ id: "at-floor", similarity: 0.60 }),
      chunk({ id: "below-floor", similarity: 0.59 }),
    ]);
    assertEquals(result.map((r) => r.id), ["at-floor"]);
  } finally {
    restore();
  }
});

Deno.test("rerankChunks: never throws even on pathological input (ties, duplicate ids)", async () => {
  const restore = withoutCohereKey();
  try {
    const chunks = [
      chunk({ id: "x", similarity: 0.7 }),
      chunk({ id: "x", similarity: 0.7 }),
    ];
    let threw = false;
    try {
      await rerankChunks("What is CKD?", chunks);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
  } finally {
    restore();
  }
});

function cohereResponse(results: { index: number; relevance_score: number }[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("rerankChunks: Cohere-shaped response filters below threshold, preserves Cohere order", async () => {
  const chunks: RetrievedChunk[] = [
    chunk({ id: "0", similarity: 0.1 }), // vector similarity is irrelevant once reranked
    chunk({ id: "1", similarity: 0.1 }),
    chunk({ id: "2", similarity: 0.1 }),
  ];
  const originalFetch = globalThis.fetch;
  let hadKeyBefore = false;
  let originalKey: string | undefined;
  try {
    originalKey = Deno.env.get("COHERE_API_KEY");
    hadKeyBefore = true;
  } catch {
    hadKeyBefore = false;
  }
  try {
    Deno.env.set("COHERE_API_KEY", "test-key");
    // Cohere returns results already sorted by relevance_score descending.
    // index 1 (0.10) is below RERANK_THRESHOLD (0.30) and must be dropped.
    globalThis.fetch = (() =>
      Promise.resolve(
        cohereResponse([
          { index: 2, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.40 },
          { index: 1, relevance_score: 0.10 },
        ]),
      )) as typeof fetch;
    const result = await rerankChunks("What is CKD?", chunks);
    assertEquals(result.map((r) => r.id), ["2", "0"]);
    assertEquals(result[0].rerank_score, 0.91);
    assertEquals(result[1].rerank_score, 0.40);
  } finally {
    globalThis.fetch = originalFetch;
    if (hadKeyBefore && originalKey !== undefined) {
      Deno.env.set("COHERE_API_KEY", originalKey);
    } else {
      try {
        Deno.env.delete("COHERE_API_KEY");
      } catch {
        // no env permission — nothing to clean up
      }
    }
  }
});

Deno.test("rerankChunks: malformed Cohere response degrades to fallback, never throws", async () => {
  const chunks: RetrievedChunk[] = [
    chunk({ id: "hi", similarity: 0.8 }),
    chunk({ id: "lo", similarity: 0.2 }),
  ];
  const originalFetch = globalThis.fetch;
  try {
    Deno.env.set("COHERE_API_KEY", "test-key");
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ unexpected: "shape" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;
    let threw = false;
    let result: RetrievedChunk[] = [];
    try {
      result = await rerankChunks("What is CKD?", chunks);
    } catch {
      threw = true;
    }
    assertEquals(threw, false);
    // Fallback semantics: only the >=0.60 chunk survives.
    assertEquals(result.map((r) => r.id), ["hi"]);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      Deno.env.delete("COHERE_API_KEY");
    } catch {
      // no env permission — nothing to clean up
    }
  }
});
