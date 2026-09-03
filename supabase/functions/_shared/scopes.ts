// Retrieval scopes for the shared RAG pipeline.
//
// Both chatbots ground on ONE corpus (public.knowledge_chunks) and one
// retrieval path. What separates them is scope metadata carried on each
// chunk and applied as a structural filter inside the match_knowledge_chunks
// RPC — not separate tables, not separate projects, and above all not an
// instruction handed to the language model.
//
// This module is the single place where per-scope retrieval parameters are
// defined, so "the similarity threshold and top-k retrieval parameters set
// independently for each scope" is one auditable object rather than
// constants scattered across the pipeline.
//
// Import-time side-effect-free: safe for the offline test suite and for the
// ingestion scripts, which run under Deno without function secrets.

/**
 * The two retrieval scopes.
 *
 * - `general_education`      — General CKD Chatbot: the full CKD education
 *                              corpus (causes, symptoms, prevention,
 *                              management, kidney health in the Philippines).
 * - `screening_clarification` — Risk Assessment Chatbot's LLM Clarification
 *                              Engine: plain-language definitions of the nine
 *                              SCORED variables and the terms they use.
 *
 * A chunk may carry BOTH (see the scopes column comment in
 * 20260806000001_source_register_and_scopes.sql). The invariant is "every
 * retrieved passage carries the requested scope", not corpus disjointness.
 */
export type RetrievalScope = "general_education" | "screening_clarification";

export const RETRIEVAL_SCOPES: readonly RetrievalScope[] = [
  "general_education",
  "screening_clarification",
] as const;

const SCOPE_SET = new Set<string>(RETRIEVAL_SCOPES);

/** True iff `value` is one of the two recognised scopes (exact match). */
export function isRetrievalScope(value: unknown): value is RetrievalScope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

/** Per-scope retrieval and reranking parameters. */
export interface ScopeProfile {
  /** Candidate pool size handed to the reranker (the RPC's match_count). */
  topK: number;
  /** Minimum cosine similarity to enter the candidate pool. */
  vectorFloor: number;
  /** Minimum Cohere relevance_score to survive reranking. */
  rerankThreshold: number;
  /** Max chunks that reach the generation context. */
  rerankTopN: number;
  /** Cosine floor used only on the degraded (no-reranker) path. */
  fallbackSimilarity: number;
  /**
   * Minimum cosine similarity between a new query and a cached one before
   * the cached reply is served instead of generating a fresh answer.
   *
   * A different KIND of threshold from the four above. Those compare a
   * question to a PASSAGE and decide whether it is worth showing; this
   * compares a question to another QUESTION and decides whether the two are
   * the same question. The failure it must not commit is answering what a
   * user did not ask, which no downstream stage can catch — the reply is
   * served verbatim, having already passed every guard for a different
   * question.
   *
   * SET FROM MEASUREMENT, NOT INTUITION, and the measurement was
   * unflattering. On 2026-08-07, embedding similarity was shown NOT to
   * separate paraphrases from near-misses on this corpus under either
   * geometry: with SEMANTIC_SIMILARITY, same-meaning pairs bottomed out at
   * 0.885 while different-meaning pairs ("prevent CKD" vs "treat CKD")
   * reached 0.925 — an overlapping band with no safe cut inside it.
   *
   * These values therefore sit ABOVE the entire measured false-hit range
   * rather than inside the overlap. That makes tier 2 a rare-hit backstop by
   * design; the exact-match tier in answer-cache.ts is what actually earns
   * the savings. Lowering these to raise the hit rate walks straight into
   * the overlap — do not, without re-measuring and finding a wider gap.
   */
  cacheHitThreshold: number;
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
 * Retrieval parameters per scope.
 *
 * `general_education` keeps the values empirically tuned against this corpus
 * with gemini-embedding-001 (evergreen CKD questions score ~0.60-0.64,
 * off-topic ~0.43-0.45) and exercised by the existing test suite. Do not
 * retune them as a side effect of adding the second scope.
 *
 * `screening_clarification` is deliberately STRICTER on the reranked path —
 * a higher relevance threshold and a smaller pool — because of where it
 * sits. A loosely-relevant passage returned mid-assessment is not merely
 * unhelpful: it is adjacent to a validated instrument, arriving at the
 * moment the user is deciding how to answer a scored variable. The engine
 * declining to answer is a normal, designed outcome there; the user records
 * zero when uncertain, per the licensed AstraZeneca patient card, and the
 * controller resumes untouched. Precision is worth more than recall on this
 * path.
 *
 * `fallbackSimilarity` is the ONE parameter where clarification is NOT
 * stricter, and the exception is deliberate. It was 0.65, which measurement
 * on 2026-08-06 showed to be not "strict" but UNREACHABLE: the engine
 * deflected every natural-language question while answering bare keywords,
 * because phrasing a term as a question costs ~0.03 cosine.
 *
 * Two things were changed together, and the second is what actually fixed
 * it. The floor came down to 0.57, and the screening file was restructured
 * from one 1429-char chunk covering all nine SCORED variables into one H2
 * section PER variable — nine terms sharing one embedding diluted every one
 * of them. (That file has since split by provenance into
 * knowledge/official-health-body/niddk/screening-and-risk-factors.md and
 * knowledge/peer-reviewed/scored/scored-instrument.md. The nine sections
 * moved verbatim and only `content` is embedded, so the numbers below still
 * hold; the one-H2-per-variable constraint now applies to both files.)
 *
 * Measured after the restructure (2026-08-06, 39 chunks), top cosine per
 * term in this scope:
 *   peripheral vascular disease 0.791 (was 0.569, and previously matched
 *   the wrong chunk entirely), proteinuria 0.738, age 0.752, sex 0.740,
 *   anemia 0.718, hypertension 0.680, heart failure 0.669, cardiovascular
 *   disease 0.664, diabetes 0.662. Off-topic controls: 0.489, 0.494.
 *
 * RE-MEASURED 2026-08-30 against the live 122-chunk corpus, via
 * scripts/measure-clarification.ts (REVIEW-FLAGS.md §12.6 asked for this;
 * §14.8 records it). The probe strings are now pinned in that script, so
 * every run from here on is exactly comparable — the deltas against the
 * 2026-08-06 figures above are indicative only, because those probe strings
 * were never recorded.
 *   pvd 0.789, uacr 0.789, albumin 0.782, proteinuria 0.781, ckd_definition
 *   0.767, egfr 0.718, anemia 0.714, age 0.703, cvd 0.693, hypertension
 *   0.686, chf 0.674, diabetes 0.636, sex 0.633. bp_threshold is the
 *   strongest at 0.830. Off-topic controls: 0.541, 0.518, 0.513.
 *
 * 0.57 STILL SITS IN OPEN SPACE, AND THE MARGIN HAS ROUGHLY HALVED. Every
 * in-scope probe clears it and every control stays below it, but the gap
 * between the weakest in-scope probe (sex, 0.633) and the strongest control
 * (weather, 0.541) is now 0.092, against ~0.17 in August. Headroom is 0.063
 * below the weakest term and only 0.029 above the strongest control.
 *
 * Both ends moved. `sex` fell the furthest of any term, and the weather
 * control ROSE to 0.541 — it now matches the PSH blood-pressure chunk, which
 * did not exist in the 39-chunk corpus. That is the predictable cost of
 * adding clarification-scoped files: an off-topic probe has more surface to
 * land on. 0.029 is thin. Re-run the script after any further change to this
 * scope's membership, and treat a control above ~0.55 as a signal to raise
 * the floor rather than to widen the corpus again.
 *
 * If a future edit merges the per-variable sections back together, this
 * margin collapses and the engine starts silently deflecting again; the
 * file's front-matter carries a warning to that effect.
 *
 * This only ever applies on the DEGRADED path taken when COHERE_API_KEY is
 * unset and there is no reranker to be strict with — which is the live
 * configuration as of 2026-08-06. Set that key and this number stops being
 * load-bearing; rerankThreshold (0.45, genuinely stricter than general
 * education's 0.30) resumes doing the work.
 */
export const SCOPE_PROFILES: Record<RetrievalScope, ScopeProfile> = {
  general_education: {
    topK: envNumber("RETRIEVAL_TOP_K", 20),
    vectorFloor: envNumber("VECTOR_SIMILARITY_FLOOR", 0.45),
    rerankThreshold: envNumber("RERANK_THRESHOLD", 0.30),
    rerankTopN: envNumber("RERANK_TOP_N", 4),
    fallbackSimilarity: envNumber("FALLBACK_SIMILARITY_THRESHOLD", 0.60),
    // 0.97: 0.045 clear of the worst measured false-hit pair (0.925).
    cacheHitThreshold: envNumber("CACHE_HIT_THRESHOLD", 0.97),
  },
  screening_clarification: {
    topK: envNumber("CLARIFY_RETRIEVAL_TOP_K", 12),
    vectorFloor: envNumber("CLARIFY_VECTOR_SIMILARITY_FLOOR", 0.50),
    rerankThreshold: envNumber("CLARIFY_RERANK_THRESHOLD", 0.45),
    rerankTopN: envNumber("CLARIFY_RERANK_TOP_N", 3),
    // 0.57, not 0.65 — see the note above. The old default deflected every
    // natural-language question on the no-reranker path.
    fallbackSimilarity: envNumber("CLARIFY_FALLBACK_SIMILARITY", 0.57),
    // Stricter still, consistent with every other clarification threshold and
    // for the same reason: this runs beside a validated instrument, at the
    // moment a user is deciding how to answer a scored variable. Serving the
    // definition of the wrong term there is worse than spending a generation
    // call — and the terms most at risk of colliding are exactly the ones the
    // questionnaire asks about together. The cost of strictness is low here
    // because clarification questions are highly templated ("what does X
    // mean"), so the exact-match tier catches most repeats outright.
    cacheHitThreshold: envNumber("CLARIFY_CACHE_HIT_THRESHOLD", 0.98),
  },
};

/** Retrieval parameters for `scope`. */
export function scopeProfile(scope: RetrievalScope): ScopeProfile {
  return SCOPE_PROFILES[scope];
}
