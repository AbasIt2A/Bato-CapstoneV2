// BATO — clarification-scope retrieval probe.
//
// READ-ONLY. Embeds a fixed battery of probe strings and runs the
// match_knowledge_chunks RPC against whatever corpus is currently ingested,
// printing the top cosine per probe. It performs no INSERT, UPDATE or DELETE
// and never touches knowledge/*.md. Safe to run at any time against any
// environment the caller has credentials for.
//
// WHY THIS EXISTS
//
// scopes.ts sets CLARIFY_FALLBACK_SIMILARITY to 0.57 on the strength of a
// measurement taken on 2026-08-06, against a corpus of 39 chunks in which the
// nine SCORED variables were the only clarification-scoped definitions. The
// argument recorded there is a MARGIN argument: 0.57 sits ~0.09 below the
// weakest in-scope term and ~0.08 above the strongest off-topic probe, so it
// "sits in open space" rather than inside an overlap.
//
// That margin is a property of the corpus, not of the number. The 2026-08-11
// Top-20 curation took the corpus to 121 chunks and added three files to the
// clarification scope (REVIEW-FLAGS.md §12.6), including a second strong
// chunk for high blood pressure. Whether 0.57 still sits in open space is now
// an open empirical question, and this script is how it gets answered.
//
// THE FIRST RUN IS A BASELINE, NOT A COMPARISON. The 2026-08-06 measurement
// recorded its RESULTS in three places but never recorded the probe STRINGS
// used to produce them. They cannot be reconstructed. So the deltas this
// script prints against those historical figures are indicative only — a
// different phrasing of "anemia" moves the cosine by more than the drift being
// looked for. The probes below are therefore pinned in source, so that every
// run from this one onward IS exactly comparable. Do not edit PROBES casually;
// changing a string silently invalidates every stored comparison.
//
// Run (needs the same three secrets as a real ingestion):
//   deno task measure:clarify
//   deno run --env-file=.env --allow-env --allow-net scripts/measure-clarification.ts
//
// Exit codes: 0 = every check passed. 1 = at least one FAIL (see the verdict
// block). Infrastructure errors also exit 1, distinguishable by the message.

import { embedQuery } from "../supabase/functions/_shared/retrieval.ts";
import { scopeProfile } from "../supabase/functions/_shared/scopes.ts";

const SCOPE = "screening_clarification" as const;
const PROFILE = scopeProfile(SCOPE);

// The RPC is called with a floor of 0 rather than PROFILE.vectorFloor on
// purpose. Passing the real floor would make a term that has DROPPED BELOW it
// return zero rows — reported as "no match" when what is wanted is the number
// that shows how far it fell. Measurement wants the raw cosine; the floors are
// applied by this script afterwards, in software, where both can be shown.
const MEASUREMENT_FLOOR = 0;
const TOP_N = 3;

interface Probe {
  /** Stable identifier used in output and in any stored comparison. */
  id: string;
  /** The exact string embedded. Pinned — see the header note. */
  query: string;
  /**
   * Recorded top cosine from the 2026-08-06 measurement, where one exists.
   * Indicative only: the probe string that produced it is unknown.
   */
  baseline?: number;
  kind: "scored_variable" | "new_content" | "off_topic";
}

// The nine SCORED variables, phrased as a user mid-assessment would actually
// ask ("what does X mean"), which is the shape the clarification engine sees.
// scopes.ts records that phrasing a term as a question costs ~0.03 cosine
// versus the bare keyword — so these run ~0.03 BELOW the historical figures
// even when nothing has regressed. That is expected, not a failure.
const PROBES: Probe[] = [
  { id: "age", query: "what does the age question mean", baseline: 0.752, kind: "scored_variable" },
  { id: "sex", query: "why does it ask if I am a woman", baseline: 0.740, kind: "scored_variable" },
  { id: "anemia", query: "what does anemia mean", baseline: 0.718, kind: "scored_variable" },
  { id: "hypertension", query: "what does high blood pressure mean", baseline: 0.680, kind: "scored_variable" },
  { id: "diabetes", query: "what does diabetes mean", baseline: 0.662, kind: "scored_variable" },
  { id: "cvd", query: "what does history of heart attack or stroke mean", baseline: 0.664, kind: "scored_variable" },
  { id: "chf", query: "what does congestive heart failure mean", baseline: 0.669, kind: "scored_variable" },
  { id: "pvd", query: "what does peripheral vascular disease mean", baseline: 0.791, kind: "scored_variable" },
  { id: "proteinuria", query: "what does protein in the urine mean", baseline: 0.738, kind: "scored_variable" },

  // Added by the 2026-08-11 curation. No baseline exists for these; this run
  // establishes one.
  { id: "albumin", query: "what is albumin in the urine", kind: "new_content" },
  { id: "egfr", query: "what is eGFR", kind: "new_content" },
  { id: "uacr", query: "what is a urine albumin to creatinine ratio", kind: "new_content" },
  { id: "bp_threshold", query: "what blood pressure counts as high in the Philippines", kind: "new_content" },
  { id: "ckd_definition", query: "how is chronic kidney disease defined", kind: "new_content" },

  // Off-topic controls. The 2026-08-06 pair scored 0.489 and 0.494; those
  // strings are unknown, so these establish a fresh control baseline. They
  // must stay plausibly conversational — a string of nonsense would score
  // near zero and prove nothing about the real false-hit ceiling.
  { id: "control_weather", query: "what is the weather like in Manila today", baseline: 0.489, kind: "off_topic" },
  { id: "control_recipe", query: "how do I cook adobo for six people", baseline: 0.494, kind: "off_topic" },
  { id: "control_tech", query: "how do I reset my phone password", kind: "off_topic" },
];

interface Hit {
  similarity: number;
  source: string;
  heading_path: string;
}

interface Result {
  probe: Probe;
  hits: Hit[];
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Missing env: ${name} is required.`);
    Deno.exit(1);
  }
  return value;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  requireEnv("GEMINI_API_KEY"); // read inside embedText; fail early if absent

  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(
    `Probing scope "${SCOPE}" — ${PROBES.length} probes, top ${TOP_N} each.\n` +
      `Thresholds in force: vectorFloor ${PROFILE.vectorFloor}, ` +
      `fallbackSimilarity ${PROFILE.fallbackSimilarity}, ` +
      `rerankThreshold ${PROFILE.rerankThreshold}.\n`,
  );

  const results: Result[] = [];
  for (const probe of PROBES) {
    const embedding = await embedQuery(probe.query);
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: MEASUREMENT_FLOOR,
      match_count: TOP_N,
      match_scope: SCOPE,
    });
    if (error) {
      console.error(`RPC failed for "${probe.id}": ${error.message}`);
      Deno.exit(1);
    }
    const hits: Hit[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      similarity: typeof row.similarity === "number" ? row.similarity : 0,
      source: String(row.source ?? ""),
      heading_path: String(row.heading_path ?? ""),
    }));
    results.push({ probe, hits });
  }

  // --- Per-probe table -----------------------------------------------------

  console.log("Top match per probe:\n");
  console.table(
    results.map(({ probe, hits }) => {
      const top = hits[0];
      const delta = top && probe.baseline !== undefined
        ? (top.similarity - probe.baseline)
        : undefined;
      return {
        probe: probe.id,
        kind: probe.kind,
        top_cosine: top ? Number(top.similarity.toFixed(3)) : null,
        "2026-08-06": probe.baseline ?? "—",
        delta: delta === undefined ? "—" : Number(delta.toFixed(3)),
        source: top?.source ?? "—",
        matched_section: top?.heading_path.split(" > ").slice(1).join(" > ") ?? "—",
      };
    }),
  );

  // --- Collisions ----------------------------------------------------------
  //
  // The failure this catches is the one the clarification scope exists to
  // prevent: serving the definition of the WRONG term beside a validated
  // instrument. It shows up as two probes whose top hit is the same chunk, or
  // as a runner-up sitting within a hair of the winner.

  console.log("\nRunner-up margins (small margin ⇒ two chunks competing):\n");
  console.table(
    results
      .filter((r) => r.probe.kind !== "off_topic" && r.hits.length >= 2)
      .map(({ probe, hits }) => ({
        probe: probe.id,
        top: Number(hits[0].similarity.toFixed(3)),
        runner_up: Number(hits[1].similarity.toFixed(3)),
        margin: Number((hits[0].similarity - hits[1].similarity).toFixed(3)),
        runner_up_source: hits[1].source,
        runner_up_section: hits[1].heading_path.split(" > ").slice(1).join(" > "),
      })),
  );

  const seen = new Map<string, string[]>();
  for (const { probe, hits } of results) {
    if (probe.kind === "off_topic" || hits.length === 0) continue;
    const key = hits[0].heading_path;
    seen.set(key, [...(seen.get(key) ?? []), probe.id]);
  }
  const shared = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  if (shared.length > 0) {
    console.log("\n⚠ Chunks winning MORE THAN ONE probe:\n");
    for (const [heading, ids] of shared) {
      console.log(`  ${heading}\n      claimed by: ${ids.join(", ")}`);
    }
    console.log(
      "\n  Not automatically a fault — related probes can legitimately share a\n" +
        "  best answer. It IS a fault if two DIFFERENT SCORED variables share\n" +
        "  one, which is the dilution failure REVIEW-FLAGS.md §9 fixed.",
    );
  }

  // --- Verdict -------------------------------------------------------------

  const inScope = results.filter((r) => r.probe.kind !== "off_topic");
  const offTopic = results.filter((r) => r.probe.kind === "off_topic");

  const topOf = (r: Result) => r.hits[0]?.similarity ?? 0;
  const weakestInScope = inScope.reduce((a, b) => topOf(a) <= topOf(b) ? a : b);
  const strongestOffTopic = offTopic.reduce((a, b) => topOf(a) >= topOf(b) ? a : b);

  const floor = PROFILE.fallbackSimilarity;
  const belowFloor = inScope.filter((r) => topOf(r) < floor);
  const controlsAboveFloor = offTopic.filter((r) => topOf(r) >= floor);
  const gap = topOf(weakestInScope) - topOf(strongestOffTopic);

  console.log("\n" + "=".repeat(72));
  console.log("VERDICT — is fallbackSimilarity still in open space?");
  console.log("=".repeat(72));
  console.log(
    `\n  weakest in-scope probe : ${topOf(weakestInScope).toFixed(3)}  ` +
      `(${weakestInScope.probe.id})`,
  );
  console.log(
    `  strongest off-topic    : ${topOf(strongestOffTopic).toFixed(3)}  ` +
      `(${strongestOffTopic.probe.id})`,
  );
  console.log(`  separation             : ${gap.toFixed(3)}`);
  console.log(`  fallbackSimilarity     : ${floor}`);
  console.log(
    `  headroom below weakest : ${(topOf(weakestInScope) - floor).toFixed(3)}`,
  );
  console.log(
    `  headroom above control : ${(floor - topOf(strongestOffTopic)).toFixed(3)}\n`,
  );

  let failed = false;

  if (belowFloor.length > 0) {
    failed = true;
    console.log(
      `  ✖ FAIL — ${belowFloor.length} in-scope probe(s) fall BELOW ${floor}. On the\n` +
        "    degraded (no-reranker) path the engine will silently DEFLECT these:\n",
    );
    for (const r of belowFloor) {
      console.log(`      ${r.probe.id.padEnd(16)} ${topOf(r).toFixed(3)}`);
    }
    console.log();
  } else {
    console.log(`  ✔ every in-scope probe clears ${floor}.`);
  }

  if (controlsAboveFloor.length > 0) {
    failed = true;
    console.log(
      `  ✖ FAIL — ${controlsAboveFloor.length} off-topic control(s) CLEAR ${floor}.\n` +
        "    The engine would answer questions it has no business answering:\n",
    );
    for (const r of controlsAboveFloor) {
      console.log(`      ${r.probe.id.padEnd(16)} ${topOf(r).toFixed(3)}`);
    }
    console.log();
  } else {
    console.log(`  ✔ every off-topic control stays below ${floor}.`);
  }

  if (gap <= 0) {
    failed = true;
    console.log(
      "\n  ✖ FAIL — in-scope and off-topic ranges OVERLAP. No threshold can\n" +
        "    separate them; this is not fixable by moving the number. Fix the\n" +
        "    corpus (see REVIEW-FLAGS.md §9 for how the last one was fixed).",
    );
  } else if (gap < 0.05) {
    console.log(
      `\n  ⚠ WARN — separation of ${gap.toFixed(3)} is narrow. It was ~0.17 on\n` +
        "    2026-08-06 (0.662 weakest in-scope vs 0.494 strongest control).\n" +
        "    Still separable, but the margin no longer absorbs drift.",
    );
  }

  console.log(
    "\n  Reminder: fallbackSimilarity only binds on the DEGRADED path taken\n" +
      "  when COHERE_API_KEY is unset. With a reranker configured,\n" +
      `  rerankThreshold (${PROFILE.rerankThreshold}) does this work instead.\n`,
  );

  if (failed) {
    console.log(
      "One or more checks FAILED. Do NOT treat the clarification thresholds in\n" +
        "scopes.ts as validated against this corpus. Record the run in\n" +
        "REVIEW-FLAGS.md before changing any number.\n",
    );
    Deno.exit(1);
  }

  console.log(
    "All checks passed. Update the measured figures in scopes.ts,\n" +
      "docs/system-overview.md and REVIEW-FLAGS.md §12.6 with THIS run's\n" +
      "numbers, and note that the probe strings now live in this file.\n",
  );
}

if (import.meta.main) {
  await main();
}
