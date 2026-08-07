// Semantic answer cache for the shared grounded RAG pipeline.
//
// Sits between the input gate and retrieval. On a hit, a previously generated
// and fully-guarded reply is served verbatim and the request costs ZERO
// generation calls; on a miss the pipeline runs unchanged and the finished
// reply is written back.
//
// ===== WHY =====
//
// Gemini's free tier meters generateContent at 20/day per project per model,
// and generation is the only stage that cannot be moved elsewhere or tuned
// cheaper. In an evaluation study a cohort works from a shared task script,
// so the same few dozen questions arrive in a few hundred phrasings. Matching
// is by embedding rather than by text precisely because those re-phrasings
// are the traffic worth catching — and the query embedding already exists at
// this point in the request, so a probe adds one small vector search and no
// API call. See 20260807000001_answer_cache.sql for the schema-side rationale.
//
// ===== WHY TWO TIERS, AND WHY SIMILARITY ALONE IS NOT ENOUGH =====
//
// Measured against this corpus on 2026-08-07, embedding similarity CANNOT
// safely tell a paraphrase from a different question. The distributions
// overlap under both available geometries:
//
//                          RETRIEVAL_QUERY   SEMANTIC_SIMILARITY
//   same meaning, lowest        0.729               0.885
//   different meaning, highest  0.863               0.925
//
// Concretely, under SEMANTIC_SIMILARITY "How do I prevent CKD?" and "How do I
// TREAT CKD?" score 0.925, while the genuine paraphrase "Can you explain
// chronic kidney disease?" / "what does CKD mean" scores only 0.885. Any
// threshold loose enough to catch the second serves a treatment answer to a
// prevention question — and nothing downstream can catch that, because a
// cached reply is served verbatim, having passed its guards for a DIFFERENT
// question.
//
// The cause is structural rather than fixable by tuning: these embeddings
// encode topic, and prevent/treat, curable/preventable, avoid/prefer are
// single operators that barely move the vector while completely changing
// which answer is correct.
//
// So the cache is built the other way round — safety first, savings second:
//
//   Tier 1, EXACT (normalised text). Zero false-positive risk by
//   construction; two questions match only if they are the same string once
//   case, punctuation and whitespace are normalised away. This is also the
//   tier that pays: in an evaluation study participants work from a task
//   script, so literal repeats of the same scripted question are the dominant
//   repeat pattern. Costs one indexed lookup and NO embedding call.
//
//   Tier 2, SEMANTIC. Runs only on a tier-1 miss, at a threshold set ABOVE
//   every false-hit pair measured (0.97 general / 0.98 clarify versus a worst
//   observed 0.925). Deliberately conservative: it exists to catch trivial
//   restatements, and is expected to hit rarely. If a future measurement
//   widens the trap set and finds a pair above 0.97, RAISE this — do not
//   trade the margin for hit rate.
//
// ===== SAFETY CONTRACT =====
//
// Three rules, all enforced here:
//
//   1. NEVER IN FRONT OF THE GATE. Callers probe only after classifyQuery()
//      has passed the message. A cached reply is therefore unreachable by a
//      message the gate would have blocked, and the cache cannot become a
//      way around scope or injection screening.
//
//   2. NEVER CACHE A DEFLECTION. storeAnswer() is only ever reached on the
//      success path, after the rerank threshold, the diagnostic-language
//      filter and the output guard have all passed. This is not tidiness: a
//      deflection is usually the symptom of something transient — exhausted
//      quota, a provider timeout, a reranker hiccup — and storing one would
//      turn a passing outage into a permanent wrong answer for every future
//      phrasing near it. Deflections are also free to recompute.
//
//   3. NEVER FAIL A REQUEST. Every function here swallows its own errors. A
//      missing table (the migration is checkpoint-gated and may not be
//      applied yet), a revoked grant, a network blip — all degrade to "cache
//      miss" or "not stored", logged server-side, with the pipeline behaving
//      exactly as it did before this module existed.
//
// Re-running the output guards on a cached reply would be redundant: they are
// deterministic and the stored text is byte-identical to what already passed
// them.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type RetrievalScope, scopeProfile } from "./scopes.ts";

/** A cached reply, ready to serve. */
export interface CachedAnswer {
  id: string;
  /** The question that matched — logged, never shown to a user. */
  question: string;
  reply: string;
  sources: unknown[];
  /** Which tier matched. Logged so hit sources stay distinguishable. */
  tier: "exact" | "semantic";
  /** Cosine similarity; exactly 1 for an exact match. */
  similarity: number;
}

/**
 * Canonical form used by the exact tier.
 *
 * Folds away only differences that cannot change meaning: case, surrounding
 * and repeated whitespace, and trailing terminal punctuation. Deliberately
 * NOT stemming, stop-word removal or internal punctuation stripping — every
 * one of those can merge two questions that differ in meaning, which is the
 * single thing this tier exists to make impossible. "Is CKD curable" and "Is
 * CKD preventable" must stay distinct strings, and they do.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s?!.]+$/, "")
    .trim();
}

/**
 * Master switch. Set ANSWER_CACHE_ENABLED=false to bypass the cache entirely
 * without a redeploy of code — useful when measuring true per-request latency
 * or generation behaviour, and necessary for any evaluation condition that
 * must observe fresh generation on every message.
 *
 * Defaults to ON: the quota pressure this exists to relieve is the normal
 * operating condition, not the exception.
 */
export function answerCacheEnabled(): boolean {
  try {
    return Deno.env.get("ANSWER_CACHE_ENABLED") !== "false";
  } catch {
    return true; // no env permission (offline tests)
  }
}

/** Shapes a raw row into a CachedAnswer, or null if it is unusable. */
function toCachedAnswer(
  row: Record<string, unknown> | undefined,
  tier: "exact" | "semantic",
  similarity: number,
): CachedAnswer | null {
  if (!row) return null;
  // Defensive mapping, as in retrieval.ts: a malformed row is a miss, never
  // a half-built reply served to a user.
  const reply = typeof row.reply === "string" ? row.reply : "";
  if (!reply.trim()) return null;
  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    question: typeof row.question === "string" ? row.question : "",
    reply,
    sources: Array.isArray(row.sources) ? row.sources : [],
    tier,
    similarity,
  };
}

/**
 * TIER 1 — exact match on the normalised question, within scope.
 *
 * Costs one indexed lookup and no embedding call, and cannot produce a false
 * hit. Callers run this BEFORE embedding anything. Never throws.
 */
export async function lookupExactAnswer(
  supabase: SupabaseClient,
  question: string,
  scope: RetrievalScope,
): Promise<CachedAnswer | null> {
  if (!answerCacheEnabled()) return null;

  try {
    const { data, error } = await supabase
      .from("answer_cache")
      .select("id, question, reply, sources")
      .eq("scope", scope)
      .eq("question_norm", normalizeQuestion(question))
      .limit(1);
    if (error) {
      console.warn(
        "answer-cache: exact lookup failed — treating as miss:",
        error.message,
      );
      return null;
    }
    return toCachedAnswer(
      (data ?? [])[0] as Record<string, unknown> | undefined,
      "exact",
      1,
    );
  } catch (err) {
    console.warn("answer-cache: exact lookup threw — treating as miss:", err);
    return null;
  }
}

/**
 * TIER 2 — nearest cached reply by cosine similarity within `scope`, or null.
 *
 * `embedding` MUST come from embedForCache() (SEMANTIC_SIMILARITY), not from
 * embedQuery() (RETRIEVAL_QUERY): the cache is built from the former, and
 * comparing across the two geometries produces a meaningless number.
 *
 * Never throws: every failure is a miss.
 */
export async function lookupCachedAnswer(
  supabase: SupabaseClient,
  embedding: number[],
  scope: RetrievalScope,
): Promise<CachedAnswer | null> {
  if (!answerCacheEnabled()) return null;

  try {
    const { data, error } = await supabase.rpc("match_answer_cache", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: scopeProfile(scope).cacheHitThreshold,
      match_scope: scope,
    });
    if (error) {
      // Includes the "function does not exist" case before the migration is
      // applied, which is why this is a warning and not an error: an
      // un-migrated project is a supported state, it just never hits.
      console.warn("answer-cache: lookup failed — treating as miss:", error.message);
      return null;
    }

    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    const similarity = typeof row?.similarity === "number" ? row.similarity : 0;
    return toCachedAnswer(row, "semantic", similarity);
  } catch (err) {
    console.warn("answer-cache: lookup threw — treating as miss:", err);
    return null;
  }
}

/**
 * Records a cache hit for telemetry. Fire-and-forget: awaited only so the
 * Edge Function's runtime is not cut short mid-write, and incapable of
 * affecting the reply either way.
 */
export async function recordCacheHit(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  try {
    await supabase.rpc("touch_answer_cache", { cache_id: id });
  } catch (err) {
    console.warn("answer-cache: hit counter not recorded:", err);
  }
}

/**
 * Stores a finished reply.
 *
 * Call ONLY on the success path — after rerank, the diagnostic-language
 * filter and the output guard have all passed, and never for a deflection
 * (see rule 2 in the module header). Never throws; a failed write just means
 * the next identical question regenerates.
 */
export async function storeAnswer(
  supabase: SupabaseClient,
  entry: {
    scope: RetrievalScope;
    /** The exact text that was embedded to produce `embedding`. */
    question: string;
    /** MUST come from embedForCache(), matching the tier-2 lookup space. */
    embedding: number[];
    reply: string;
    sources: unknown[];
    model: string;
  },
): Promise<void> {
  if (!answerCacheEnabled()) return;

  try {
    const { error } = await supabase.from("answer_cache").insert({
      scope: entry.scope,
      question: entry.question,
      // Written here rather than by a database trigger so the canonical form
      // is owned by the same code that queries it — the two can never drift
      // into disagreeing about what "the same question" means.
      question_norm: normalizeQuestion(entry.question),
      embedding: JSON.stringify(entry.embedding),
      reply: entry.reply,
      sources: entry.sources,
      model: entry.model,
    });
    if (error) {
      console.warn("answer-cache: store failed — not cached:", error.message);
    }
  } catch (err) {
    console.warn("answer-cache: store threw — not cached:", err);
  }
}
