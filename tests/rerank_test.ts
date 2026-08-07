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

// ---------------------------------------------------------------------------
// Per-scope thresholds on the COHERE path
//
// REGRESSION GUARD. The Cohere branch used to apply the module-level
// RERANK_THRESHOLD (0.30) and RERANK_TOP_N (4) — general-education values —
// regardless of the scope passed in, so the clarification engine silently ran
// at general-education strictness instead of its stricter 0.45 / top-3. That
// inverts the precision-over-recall trade-off documented at length in
// scopes.ts, right beside a validated instrument.
//
// It survived undetected because COHERE_API_KEY was unset for this project's
// entire history: every request took fallbackBySimilarity(), which reads the
// profile correctly. The test above could not catch it either, because it
// exercises only the default scope, where the constant and the profile value
// happen to be equal. These tests use the scope where they DIFFER.
// ---------------------------------------------------------------------------

/** Runs `fn` with a fake Cohere key and a stubbed fetch, restoring both. */
async function withCohere(
  respond: (body: Record<string, unknown>) => Response,
  fn: (sent: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  let original: string | undefined;
  try {
    original = Deno.env.get("COHERE_API_KEY");
  } catch { /* no env permission */ }
  const sent: Record<string, unknown>[] = [];
  try {
    Deno.env.set("COHERE_API_KEY", "test-key");
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push(body);
      return Promise.resolve(respond(body));
    }) as typeof fetch;
    await fn(sent);
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) Deno.env.set("COHERE_API_KEY", original);
    else {
      try {
        Deno.env.delete("COHERE_API_KEY");
      } catch { /* no env permission */ }
    }
  }
}

Deno.test("rerankChunks: clarify scope applies ITS threshold (0.45), not 0.30", async () => {
  const chunks: RetrievedChunk[] = [
    chunk({ id: "0", scopes: ["screening_clarification"] }),
    chunk({ id: "1", scopes: ["screening_clarification"] }),
    chunk({ id: "2", scopes: ["screening_clarification"] }),
  ];
  await withCohere(
    () =>
      cohereResponse([
        { index: 0, relevance_score: 0.91 },
        // Both of these clear the general threshold (0.30) and must still be
        // dropped under clarification's 0.45. 0.305 is the score actually
        // observed being wrongly kept in production.
        { index: 1, relevance_score: 0.40 },
        { index: 2, relevance_score: 0.305 },
      ]),
    async () => {
      const result = await rerankChunks("What is anemia?", chunks, "screening_clarification");
      assertEquals(result.map((r) => r.id), ["0"]);
    },
  );
});

Deno.test("rerankChunks: general scope still keeps 0.30-0.45 chunks", async () => {
  // The mirror of the test above: the fix must not make general education
  // stricter as a side effect.
  const chunks: RetrievedChunk[] = [chunk({ id: "0" }), chunk({ id: "1" })];
  await withCohere(
    () =>
      cohereResponse([
        { index: 0, relevance_score: 0.91 },
        { index: 1, relevance_score: 0.35 },
      ]),
    async () => {
      const result = await rerankChunks("What is CKD?", chunks, "general_education");
      assertEquals(result.map((r) => r.id), ["0", "1"]);
    },
  );
});

Deno.test("rerankChunks: each scope requests and caps at ITS OWN top-N", async () => {
  const many: RetrievedChunk[] = Array.from(
    { length: 6 },
    (_, i) => chunk({ id: String(i) }),
  );
  const allRelevant = Array.from(
    { length: 6 },
    (_, i) => ({ index: i, relevance_score: 0.9 }),
  );

  await withCohere(() => cohereResponse(allRelevant), async (sent) => {
    const result = await rerankChunks("q", many, "screening_clarification");
    assertEquals(sent[0].top_n, 3, "clarify must ask Cohere for its own top-N");
    assertEquals(result.length, 3, "clarify must cap at 3, not 4");
  });

  await withCohere(() => cohereResponse(allRelevant), async (sent) => {
    const result = await rerankChunks("q", many, "general_education");
    assertEquals(sent[0].top_n, 4);
    assertEquals(result.length, 4);
  });
});
