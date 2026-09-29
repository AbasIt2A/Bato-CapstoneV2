// Answer-cache and generation-model-split tests.
//
// Both exist to relieve the same constraint: Gemini's free tier meters
// generateContent at 20/day per project PER MODEL. The split gives each
// chatbot its own bucket; the cache stops repeated phrasings of one question
// from each drawing on it.
//
// The properties pinned here are the ones whose failure would be silent:
//
//   * the two chatbots must NOT resolve to the same model, or the split
//     quietly halves the day's capacity again;
//   * a cache lookup must never throw and never serve across scopes;
//   * cache errors — including the table simply not existing, which is the
//     state before the checkpoint-gated migration is applied — must degrade
//     to a miss, not to a failed request.
//
// No network and no database; the Supabase client is stubbed.

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  answerCacheEnabled,
  lookupCachedAnswer,
  lookupExactAnswer,
  normalizeQuestion,
  recordCacheHit,
  selectCachedVariant,
  storeAnswer,
  storeAnswerVariant,
} from "../supabase/functions/_shared/answer-cache.ts";
import {
  CLARIFY_GENERATION_MODEL_DEFAULT,
  GENERATION_MODEL_DEFAULT,
  generationModelFor,
} from "../supabase/functions/_shared/gemini.ts";
import { GATE_MODEL_DEFAULT } from "../supabase/functions/_shared/gate.ts";
import { SCOPE_PROFILES } from "../supabase/functions/_shared/scopes.ts";

const MANAGED = [
  "ANSWER_CACHE_ENABLED",
  "GEMINI_MODEL",
  "CLARIFY_GEMINI_MODEL",
];

function withEnv(env: Record<string, string>, fn: () => void | Promise<void>) {
  const saved = new Map(MANAGED.map((k) => [k, Deno.env.get(k)]));
  for (const key of MANAGED) Deno.env.delete(key);
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const restore = () => {
    for (const key of MANAGED) {
      const value = saved.get(key);
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return Promise.resolve();
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** Records the most recent PostgREST-style select chain. */
let lastSelect: { table: string; filters: Record<string, unknown> } | null = null;

/** Minimal Supabase stand-in: records rpc/insert/select calls, canned data. */
function stubClient(options: {
  rpcData?: unknown;
  rpcError?: { message: string };
  insertError?: { message: string };
  updateError?: { message: string };
  selectData?: unknown[];
  selectError?: { message: string };
  throwOn?: string;
}): { client: SupabaseClient; rpcCalls: RpcCall[]; inserts: unknown[]; updates: unknown[] } {
  const rpcCalls: RpcCall[] = [];
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  lastSelect = null;
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (options.throwOn === name) throw new Error("connection reset");
      if (name === "touch_answer_cache" && !options.rpcError) {
        const row = options.selectData?.find((item) =>
          (item as Record<string, unknown>).id === args.cache_id
        ) as Record<string, unknown> | undefined;
        if (row && typeof row.hit_count === "number") row.hit_count++;
      }
      return Promise.resolve({
        data: options.rpcData ?? null,
        error: options.rpcError ?? null,
      });
    },
    from(table: string) {
      return {
        insert(row: unknown) {
          inserts.push(row);
          if (options.throwOn === "insert") throw new Error("connection reset");
          return Promise.resolve({ error: options.insertError ?? null });
        },
        update(row: Record<string, unknown>) {
          if (options.throwOn === "update") throw new Error("connection reset");
          return {
            eq(column: string, value: unknown) {
              updates.push({ table, column, value, row });
              if (!options.updateError && column === "id") {
                const existing = options.selectData?.find((item) =>
                  (item as Record<string, unknown>).id === value
                ) as Record<string, unknown> | undefined;
                if (existing) Object.assign(existing, row);
              }
              return Promise.resolve({ error: options.updateError ?? null });
            },
          };
        },
        select(_columns: string) {
          if (options.throwOn === "select") throw new Error("connection reset");
          lastSelect = { table, filters: {} };
          // Thenable builder: .eq() chains, and awaiting it resolves the query.
          const builder = {
            eq(column: string, value: unknown) {
              lastSelect!.filters[column] = value;
              return builder;
            },
            order(_column: string, _options: unknown) {
              return builder;
            },
            limit(_n: number) {
              return Promise.resolve({
                data: options.selectData ?? [],
                error: options.selectError ?? null,
              });
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls, inserts, updates };
}

const VECTOR = Array.from({ length: 768 }, (_, i) => (i % 7) / 10);

// ---------------------------------------------------------------------------
// Generation-model split
// ---------------------------------------------------------------------------

Deno.test("models: each chatbot resolves to its OWN generation model", async () => {
  await withEnv({}, () => {
    const general = generationModelFor("general_education");
    const clarify = generationModelFor("screening_clarification");
    assertEquals(general, GENERATION_MODEL_DEFAULT);
    assertEquals(clarify, CLARIFY_GENERATION_MODEL_DEFAULT);
    // The entire point of the split: same name means one shared 20/day bucket.
    assertNotEquals(
      general,
      clarify,
      "the two chatbots must not share a Gemini free-tier bucket",
    );
  });
});

Deno.test("models: the gate fallback shares a bucket with neither generator", async () => {
  await withEnv({}, () => {
    assertNotEquals(GATE_MODEL_DEFAULT, GENERATION_MODEL_DEFAULT);
    assertNotEquals(GATE_MODEL_DEFAULT, CLARIFY_GENERATION_MODEL_DEFAULT);
  });
});

Deno.test("models: per-scope env overrides apply independently", async () => {
  await withEnv(
    { GEMINI_MODEL: "override-general", CLARIFY_GEMINI_MODEL: "override-clarify" },
    () => {
      assertEquals(generationModelFor("general_education"), "override-general");
      assertEquals(
        generationModelFor("screening_clarification"),
        "override-clarify",
      );
    },
  );
});

Deno.test("models: GEMINI_MODEL alone does not bleed into the clarification path", async () => {
  // Supabase function secrets are project-wide, so a single GEMINI_MODEL
  // secret applies to both deployed functions. If clarify read it too, the
  // split would collapse the moment anyone set that variable.
  await withEnv({ GEMINI_MODEL: "override-general" }, () => {
    assertEquals(generationModelFor("general_education"), "override-general");
    assertEquals(
      generationModelFor("screening_clarification"),
      CLARIFY_GENERATION_MODEL_DEFAULT,
    );
  });
});

// ---------------------------------------------------------------------------
// Cache thresholds
// ---------------------------------------------------------------------------

Deno.test("cache: hit thresholds are far stricter than the retrieval thresholds", async () => {
  await withEnv({}, () => {
    for (const profile of Object.values(SCOPE_PROFILES)) {
      // A cache hit asserts two QUESTIONS are the same question and serves a
      // reply with no further guard behind it, so it has to be much stricter
      // than "this passage is relevant".
      assertEquals(profile.cacheHitThreshold >= 0.9, true);
      assertEquals(profile.cacheHitThreshold > profile.rerankThreshold, true);
      assertEquals(profile.cacheHitThreshold > profile.fallbackSimilarity, true);
    }
    // Clarification stays the stricter of the two, as it is on every other
    // reranked threshold.
    assertEquals(
      SCOPE_PROFILES.screening_clarification.cacheHitThreshold >
        SCOPE_PROFILES.general_education.cacheHitThreshold,
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 1 — exact match
//
// This tier exists because measurement showed embedding similarity CANNOT
// separate paraphrases from near-misses on this corpus (same-meaning pairs
// bottom out at 0.885 while "prevent CKD" vs "treat CKD" reaches 0.925). Its
// whole value is that it cannot false-hit, so the tests that matter most are
// the ones proving meaning-bearing differences survive normalisation.
// ---------------------------------------------------------------------------

Deno.test("normalize: folds only what cannot change meaning", async () => {
  await withEnv({}, () => {
    const canonical = "what is chronic kidney disease";
    for (
      const variant of [
        "What is chronic kidney disease?",
        "  what is chronic kidney disease  ",
        "WHAT IS CHRONIC KIDNEY DISEASE!",
        "What  is   chronic  kidney   disease",
        "What is chronic kidney disease...",
      ]
    ) {
      assertEquals(normalizeQuestion(variant), canonical, variant);
    }
  });
});

Deno.test("normalize: questions differing by ONE operator stay distinct", async () => {
  await withEnv({}, () => {
    // These are the exact pairs that defeated similarity matching. If
    // normalisation ever merged them, the exact tier would inherit the same
    // failure it was built to avoid — serving a treatment answer to someone
    // asking about prevention.
    const collisions: [string, string][] = [
      ["Is CKD curable?", "Is CKD preventable?"],
      ["How do I prevent CKD?", "How do I treat CKD?"],
      ["What foods should I avoid with CKD?", "What foods are good for kidneys?"],
      ["What are the stages of CKD?", "What are the symptoms of CKD?"],
    ];
    for (const [a, b] of collisions) {
      assertNotEquals(normalizeQuestion(a), normalizeQuestion(b), `${a} vs ${b}`);
    }
  });
});

Deno.test("cache: the exact tier filters on scope AND normalised question", async () => {
  await withEnv({}, async () => {
    const { client, rpcCalls } = stubClient({});
    await lookupExactAnswer(client, "  What IS Chronic Kidney Disease? ", "general_education");
    assertEquals(rpcCalls, [], "the exact tier must not call an RPC");
    assertEquals(lastSelect?.table, "answer_cache");
    assertEquals(lastSelect?.filters.scope, "general_education");
    assertEquals(lastSelect?.filters.question_norm, "what is chronic kidney disease");
  });
});

Deno.test("cache: an exact hit reports tier 'exact' and similarity 1", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({
      selectData: [{
        id: "abc",
        question: "What is CKD?",
        reply: "CKD is a long-term kidney condition.",
        sources: [{ source: "NIDDK" }],
      }],
    });
    const hit = await lookupExactAnswer(client, "what is ckd", "general_education");
    assertEquals(hit?.tier, "exact");
    assertEquals(hit?.similarity, 1);
    assertEquals(hit?.reply, "CKD is a long-term kidney condition.");
    assertEquals(hit?.variants, undefined);
  });
});

Deno.test("cache: a legacy JSON-like reply stays readable", async () => {
  await withEnv({}, async () => {
    const reply = '{"kidney tests":["blood","urine"]}';
    const { client } = stubClient({ selectData: [{
      id: "abc", question: "q", reply, sources: [{ source: "NIDDK" }],
    }] });
    const hit = await lookupExactAnswer(client, "q", "general_education");
    assertEquals(hit?.reply, reply);
    assertEquals(hit?.variants, undefined);
  });
});

Deno.test("cache: exact lookup decodes two guarded replies and their own sources", async () => {
  await withEnv({}, async () => {
    const first = { reply: "CKD is a long-term kidney condition.", sources: [{ source: "NIDDK" }] };
    const second = { reply: "CKD means long-term kidney damage.", sources: [{ source: "CDC" }] };
    const { client } = stubClient({ selectData: [{
      id: "abc", question: "What is CKD?", sources: first.sources,
      reply: "BATO_VARIANTS_V1:" + JSON.stringify({ version: 1, variants: [first, second] }),
    }] });
    const hit = await lookupExactAnswer(client, "what is ckd", "general_education");
    assertEquals(hit?.reply, first.reply);
    assertEquals(hit?.sources, first.sources);
    assertEquals(hit?.variants, [first, second]);
  });
});

Deno.test("cache: malformed variant payload is an exact miss", async () => {
  await withEnv({}, async () => {
    for (const reply of [
      'BATO_VARIANTS_V1:{"version":1,"variants":',
      "BATO_VARIANTS_V2:" + JSON.stringify({ version: 2, variants: [{ reply: "r", sources: [] }] }),
      "BATO_VARIANTS_V1:" + JSON.stringify({ version: 1, variants: [{ reply: "r", sources: [] }, { reply: " ", sources: [] }] }),
      "BATO_VARIANTS_V1:" + JSON.stringify({ version: 1, variants: [{ reply: "r", sources: [] }, { reply: "r2", sources: "NIDDK" }] }),
    ]) {
      const { client } = stubClient({ selectData: [{ id: "abc", question: "q", reply, sources: [] }] });
      assertEquals(await lookupExactAnswer(client, "q", "general_education"), null);
    }
  });
});

Deno.test("cache: an exact-tier error is a miss, not a thrown request", async () => {
  await withEnv({}, async () => {
    // Pre-migration state: question_norm does not exist yet.
    const { client } = stubClient({
      selectError: { message: 'column answer_cache.question_norm does not exist' },
    });
    assertEquals(await lookupExactAnswer(client, "q", "general_education"), null);
    const thrown = stubClient({ throwOn: "select" });
    assertEquals(await lookupExactAnswer(thrown.client, "q", "general_education"), null);
  });
});

Deno.test("cache: a store writes the normalised form alongside the raw question", async () => {
  await withEnv({}, async () => {
    const { client, inserts } = stubClient({});
    await storeAnswer(client, {
      scope: "general_education",
      question: "What IS Chronic Kidney Disease?",
      embedding: VECTOR,
      reply: "r",
      sources: [],
      model: "m",
    });
    const row = inserts[0] as Record<string, unknown>;
    assertEquals(row.question, "What IS Chronic Kidney Disease?");
    assertEquals(row.question_norm, "what is chronic kidney disease");
  });
});

Deno.test("cache: the exact tier is bypassed when the cache is disabled", async () => {
  await withEnv({ ANSWER_CACHE_ENABLED: "false" }, async () => {
    const { client } = stubClient({
      selectData: [{ id: "a", question: "q", reply: "r", sources: [] }],
    });
    assertEquals(await lookupExactAnswer(client, "q", "general_education"), null);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — similarity
// ---------------------------------------------------------------------------

Deno.test("cache: tier-2 thresholds sit above every measured false-hit pair", async () => {
  await withEnv({}, () => {
    // Measured 2026-08-07 under SEMANTIC_SIMILARITY: the highest-scoring pair
    // that MUST NOT match was "How do I prevent CKD?" / "How do I treat CKD?"
    // at 0.925. Both thresholds must clear it with margin, or tier 2 starts
    // answering questions nobody asked.
    const WORST_FALSE_HIT = 0.925;
    for (const [name, profile] of Object.entries(SCOPE_PROFILES)) {
      assertEquals(
        profile.cacheHitThreshold > WORST_FALSE_HIT,
        true,
        `${name}: ${profile.cacheHitThreshold} must exceed ${WORST_FALSE_HIT}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

Deno.test("cache: a lookup passes its own scope and that scope's threshold", async () => {
  await withEnv({}, async () => {
    const { client, rpcCalls } = stubClient({ rpcData: [] });
    await lookupCachedAnswer(client, VECTOR, "screening_clarification");
    assertEquals(rpcCalls[0].name, "match_answer_cache");
    assertEquals(rpcCalls[0].args.match_scope, "screening_clarification");
    assertEquals(
      rpcCalls[0].args.match_threshold,
      SCOPE_PROFILES.screening_clarification.cacheHitThreshold,
    );
  });
});

Deno.test("cache: a hit returns the stored reply, sources and similarity", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({
      rpcData: [{
        id: "abc",
        question: "what is ckd",
        reply: "CKD is a long-term kidney condition.",
        sources: [{ source: "NIDDK", title: "CKD basics", heading_path: null }],
        similarity: 0.981,
      }],
    });
    const hit = await lookupCachedAnswer(client, VECTOR, "general_education");
    assertEquals(hit?.reply, "CKD is a long-term kidney condition.");
    assertEquals(hit?.sources.length, 1);
    assertEquals(hit?.similarity, 0.981);
  });
});

Deno.test("cache: semantic lookup decodes the same two-variant payload", async () => {
  await withEnv({}, async () => {
    const variants = [
      { reply: "Kidney tests can include blood tests.", sources: [{ source: "NIDDK" }] },
      { reply: "Blood tests are one way to check kidney health.", sources: [{ source: "CDC" }] },
    ];
    const { client } = stubClient({ rpcData: [{
      id: "abc", question: "kidney tests", reply: "BATO_VARIANTS_V1:" + JSON.stringify({ version: 1, variants }),
      sources: variants[0].sources, similarity: 0.981,
    }] });
    const hit = await lookupCachedAnswer(client, VECTOR, "general_education");
    assertEquals(hit?.variants, variants);
    assertEquals(hit?.reply, variants[0].reply);
    assertEquals(hit?.sources, variants[0].sources);
  });
});

Deno.test("cache: malformed variant payload is a semantic miss", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({ rpcData: [{
      id: "abc", question: "q", reply: 'BATO_VARIANTS_V1:{"version":1,"variants":', sources: [], similarity: 0.99,
    }] });
    assertEquals(await lookupCachedAnswer(client, VECTOR, "general_education"), null);
  });
});

Deno.test("cache: an RPC error is a miss, not a thrown request", async () => {
  await withEnv({}, async () => {
    // This is the pre-migration state: match_answer_cache does not exist yet.
    // The pipeline must behave exactly as it did before the cache was added.
    const { client } = stubClient({
      rpcError: { message: 'function public.match_answer_cache does not exist' },
    });
    assertEquals(await lookupCachedAnswer(client, VECTOR, "general_education"), null);
  });
});

Deno.test("cache: a thrown client is a miss", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({ throwOn: "match_answer_cache" });
    assertEquals(await lookupCachedAnswer(client, VECTOR, "general_education"), null);
  });
});

Deno.test("cache: a row with an empty reply is treated as a miss", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({
      rpcData: [{ id: "abc", question: "q", reply: "   ", sources: [], similarity: 0.99 }],
    });
    assertEquals(await lookupCachedAnswer(client, VECTOR, "general_education"), null);
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

Deno.test("cache: a stored entry carries its scope, question, reply and model", async () => {
  await withEnv({}, async () => {
    const { client, inserts } = stubClient({});
    await storeAnswer(client, {
      scope: "general_education",
      question: "what is ckd",
      embedding: VECTOR,
      reply: "CKD is a long-term kidney condition.",
      sources: [{ source: "NIDDK" }],
      model: "gemini-3.5-flash-lite",
    });
    const row = inserts[0] as Record<string, unknown>;
    assertEquals(row.scope, "general_education");
    assertEquals(row.question, "what is ckd");
    assertEquals(row.model, "gemini-3.5-flash-lite");
    // pgvector wants a JSON array literal, as in retrieval.ts.
    assertEquals(typeof row.embedding, "string");
  });
});

Deno.test("cache: a failed store never throws into the request path", async () => {
  await withEnv({}, async () => {
    const { client } = stubClient({ insertError: { message: "relation does not exist" } });
    await storeAnswer(client, {
      scope: "general_education",
      question: "q",
      embedding: VECTOR,
      reply: "r",
      sources: [],
      model: "m",
    });
    const thrown = stubClient({ throwOn: "insert" });
    await storeAnswer(thrown.client, {
      scope: "general_education",
      question: "q",
      embedding: VECTOR,
      reply: "r",
      sources: [],
      model: "m",
    });
  });
});

Deno.test("cache: upgrading a legacy answer stores two independently sourced variants", async () => {
  await withEnv({}, async () => {
    const row = { id: "abc", question: "q", reply: "First answer.", sources: [{ source: "NIDDK" }] };
    const { client, updates } = stubClient({ selectData: [row] });
    const cached = (await lookupExactAnswer(client, "q", "general_education"))!;
    assertEquals(await storeAnswerVariant(client, cached, {
      reply: "Second answer.", sources: [{ source: "CDC" }],
    }), true);
    assertEquals(updates.length, 1);
    const refreshed = await lookupExactAnswer(client, "q", "general_education");
    assertEquals(refreshed?.variants, [
      { reply: "First answer.", sources: [{ source: "NIDDK" }] },
      { reply: "Second answer.", sources: [{ source: "CDC" }] },
    ]);
  });
});

Deno.test("cache: paired replies alternate after the first rewording", async () => {
  await withEnv({}, async () => {
    for (const initialHitCount of [5, 6]) {
      const row = {
        id: "abc", question: "q", reply: "First answer.",
        sources: [{ source: "NIDDK" }], hit_count: initialHitCount,
      };
      const { client } = stubClient({ selectData: [row] });
      const cached = (await lookupExactAnswer(client, "q", "general_education"))!;
      const firstHit = await recordCacheHit(client, cached.id, true);
      await storeAnswerVariant(client, cached, {
        reply: "Second answer.", sources: [{ source: "CDC" }],
      }, firstHit);
      const paired = (await lookupExactAnswer(client, "q", "general_education"))!;
      assertEquals(selectCachedVariant(paired, firstHit! + 1).reply, cached.reply);
      assertEquals(selectCachedVariant(paired, firstHit! + 2).reply, "Second answer.");
      assertEquals(selectCachedVariant(paired, firstHit! + 3).reply, cached.reply);
    }
  });
});

Deno.test("cache: failed variant update leaves the legacy answer usable", async () => {
  await withEnv({}, async () => {
    const row = { id: "abc", question: "q", reply: "First answer.", sources: [] };
    const { client } = stubClient({ selectData: [row], updateError: { message: "network error" } });
    const cached = (await lookupExactAnswer(client, "q", "general_education"))!;
    assertEquals(await storeAnswerVariant(client, cached, {
      reply: "Second answer.", sources: [],
    }), false);
    assertEquals((await lookupExactAnswer(client, "q", "general_education"))?.reply, "First answer.");
    const thrown = stubClient({ selectData: [row], throwOn: "update" });
    assertEquals(await storeAnswerVariant(thrown.client, cached, {
      reply: "Second answer.", sources: [],
    }), false);
  });
});

// ---------------------------------------------------------------------------
// Master switch
// ---------------------------------------------------------------------------

Deno.test("cache: ANSWER_CACHE_ENABLED=false bypasses both read and write", async () => {
  await withEnv({ ANSWER_CACHE_ENABLED: "false" }, async () => {
    assertEquals(answerCacheEnabled(), false);
    const { client, rpcCalls, inserts } = stubClient({
      rpcData: [{ id: "a", question: "q", reply: "r", sources: [], similarity: 1 }],
    });
    assertEquals(await lookupCachedAnswer(client, VECTOR, "general_education"), null);
    await storeAnswer(client, {
      scope: "general_education",
      question: "q",
      embedding: VECTOR,
      reply: "r",
      sources: [],
      model: "m",
    });
    assertEquals(rpcCalls.length, 0);
    assertEquals(inserts.length, 0);
  });
});

Deno.test("cache: defaults to enabled when the variable is unset", async () => {
  await withEnv({}, () => {
    assertEquals(answerCacheEnabled(), true);
  });
});
