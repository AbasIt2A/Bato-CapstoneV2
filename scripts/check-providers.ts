// Provider health check — probes every model the pipeline actually calls.
//
// ===== WHY THIS EXISTS =====
//
// Two failures on this project both looked like "the chatbot refuses every
// question", and neither was a retrieval, threshold or prompt problem:
//
//   * Google closed the 2.5 series to new API keys, so gemini-2.5-flash
//     started returning HTTP 404 "no longer available to new users";
//   * the free-tier daily quota ran out, returning HTTP 429.
//
// Both are invisible in the reply, because the pipeline is built to degrade
// into the approved deflection rather than surface an error. The gate is
// worse still: it FAILS OPEN, so a retired gate model disables scope and
// injection screening with no user-visible symptom whatsoever.
//
// GET /v1beta/models does not help — that listing is optimistic and includes
// models a given key cannot actually call. The only reliable check is a real
// request, which is what this script makes.
//
// Model names are imported from the shared modules rather than repeated here,
// so this cannot drift from what the Edge Functions will call at runtime.
//
// ===== COST =====
//
// Each Gemini generation probe spends ONE request from a 20/day bucket.
// Three distinct Gemini models are probed (two generation, one gate
// fallback), so a full run costs 1 request from each of three separate
// buckets — not 3 from one. Embedding, Groq and Cohere probes draw on
// unrelated quotas. Pass --skip-gemini to check only the free-tier-generous
// providers when you are conserving Gemini quota.
//
// Usage:
//   deno task check:providers
//   deno task check:providers -- --skip-gemini

import {
  geminiGateModel,
  groqGateModel,
} from "../supabase/functions/_shared/gate.ts";
import { generationModelFor } from "../supabase/functions/_shared/gemini.ts";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
} from "../supabase/functions/_shared/embeddings.ts";
import { RERANK_MODEL } from "../supabase/functions/_shared/rerank.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

const skipGemini = Deno.args.includes("--skip-gemini");

interface Probe {
  /** What breaks if this fails. */
  role: string;
  model: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
  ms: number;
}

const results: Probe[] = [];

async function probe(
  role: string,
  model: string,
  fn: () => Promise<string>,
): Promise<void> {
  const started = performance.now();
  try {
    const detail = await fn();
    results.push({
      role,
      model,
      status: "ok",
      detail,
      ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    results.push({
      role,
      model,
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - started),
    });
  }
}

function skip(role: string, model: string, why: string): void {
  results.push({ role, model, status: "skipped", detail: why, ms: 0 });
}

/**
 * Turns a failed response into a message that names the actual problem.
 * A bare "HTTP 404" is what made the original outage hard to read; 404 and
 * 429 mean very different things here and the fix differs accordingly.
 */
async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const hint = response.status === 404
    ? "model unavailable to this key — pick another and update the default"
    : response.status === 429
    ? "QUOTA EXHAUSTED for today (or rate-limited) — not a code problem"
    : response.status === 401 || response.status === 403
    ? "key rejected — check the secret is set and still valid"
    : "";
  const snippet = body.slice(0, 160).replace(/\s+/g, " ").trim();
  return `HTTP ${response.status}${hint ? ` — ${hint}` : ""}${
    snippet ? ` | ${snippet}` : ""
  }`;
}

// ---------------------------------------------------------------------------
// Gemini generation models (one bucket each)
// ---------------------------------------------------------------------------

/**
 * Probes a Gemini model AT THE CONFIGURATION THE PIPELINE ACTUALLY USES —
 * same token budget, same response type, same thinking level.
 *
 * A generic toy probe is worse than useless here. Gemini 3.x charges its
 * internal reasoning against maxOutputTokens, and how much it spends varies
 * by model: probed with a 16-token budget, gemini-3.5-flash-lite answered
 * while gemini-3.5-flash and gemini-3.1-flash-lite returned
 * finishReason: MAX_TOKENS having produced no text at all. So "the model
 * responds" and "the model responds within the budget this pipeline gives it"
 * are different questions, and only the second one matters — an empty reply
 * fails the gate OPEN and turns generation into a deflection, both silently.
 */
async function probeGeminiGeneration(options: {
  model: string;
  maxOutputTokens: number;
  /** Gate calls request strict JSON; generation calls do not. */
  json: boolean;
  systemPrompt?: string;
  prompt: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: options.prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: options.maxOutputTokens,
      thinkingConfig: { thinkingLevel: "low" },
      ...(options.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (options.systemPrompt) {
    body.system_instruction = { parts: [{ text: options.systemPrompt }] };
  }

  const response = await fetch(
    `${GEMINI_BASE}/models/${options.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error(await describeFailure(response));
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "").join("").trim();
  if (!text) {
    const reason = candidate?.finishReason ?? "unknown";
    const thoughts = data?.usageMetadata?.thoughtsTokenCount;
    throw new Error(
      reason === "MAX_TOKENS"
        ? `no text within maxOutputTokens=${options.maxOutputTokens}` +
          (thoughts ? ` (spent ${thoughts} on reasoning)` : "") +
          " — raise the budget or use a model that reasons less"
        : `200 but no text (finishReason: ${reason})`,
    );
  }
  return `replied ${JSON.stringify(text.slice(0, 32))}`;
}

/** Mirrors gate.ts: strict-JSON verdict on a 256-token budget. */
const gateProbe = (model: string) =>
  probeGeminiGeneration({
    model,
    maxOutputTokens: 256,
    json: true,
    systemPrompt:
      'You are a strict input classifier. Respond with ONLY this JSON object ' +
      'and no other text: {"in_scope": <boolean>, "injection_detected": ' +
      '<boolean>, "reason": "<short reason>"}',
    prompt: "What is chronic kidney disease?",
  });

/** Mirrors gemini.ts: free-form grounded answer on a 1024-token budget. */
const generationProbe = (model: string) =>
  probeGeminiGeneration({
    model,
    maxOutputTokens: 1024,
    json: false,
    systemPrompt:
      "You answer kidney-health questions in plain language, citing the " +
      "source you were given. Keep answers short.",
    prompt:
      "SOURCE [NIDDK]: Chronic kidney disease means the kidneys are damaged " +
      "and cannot filter blood as well as they should.\n\n" +
      "QUESTION: What is chronic kidney disease?",
  });

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

const geminiKey = Deno.env.get("GEMINI_API_KEY");
const groqKey = Deno.env.get("GROQ_API_KEY");
const cohereKey = Deno.env.get("COHERE_API_KEY");

// --- Input gate, primary: Groq ---------------------------------------------
if (!groqKey) {
  skip(
    "input gate (primary)",
    groqGateModel(),
    "GROQ_API_KEY unset — the gate will fall back to Gemini and consume its quota",
  );
} else {
  await probe("input gate (primary)", groqGateModel(), async () => {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: groqGateModel(),
        messages: [
          {
            role: "system",
            content:
              'Classify the message. Respond with ONLY this JSON object: {"in_scope": <boolean>}',
          },
          { role: "user", content: "What is chronic kidney disease?" },
        ],
        temperature: 0,
        max_tokens: 64,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(await describeFailure(response));
    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("200 but empty content");
    // Confirms constrained JSON decoding works, not just that the model exists
    // — the gate parses this reply as JSON and fails open if it cannot.
    JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
    return `valid JSON verdict: ${text.slice(0, 40).replace(/\s+/g, " ")}`;
  });
}

// --- Input gate, fallback + generation: Gemini ------------------------------
if (!geminiKey) {
  skip("input gate (fallback)", geminiGateModel(), "GEMINI_API_KEY unset");
  skip("general-chat generation", generationModelFor("general_education"), "GEMINI_API_KEY unset");
  skip("clarify generation", generationModelFor("screening_clarification"), "GEMINI_API_KEY unset");
  skip("embeddings", EMBEDDING_MODEL, "GEMINI_API_KEY unset");
} else if (skipGemini) {
  skip("input gate (fallback)", geminiGateModel(), "--skip-gemini");
  skip("general-chat generation", generationModelFor("general_education"), "--skip-gemini");
  skip("clarify generation", generationModelFor("screening_clarification"), "--skip-gemini");
  // Embeddings are on a separate, far larger quota, so they are always
  // probed: a healthy embedding call is also the clearest proof that the key
  // itself is fine and any generation failure is a per-model problem.
  await probe("embeddings", EMBEDDING_MODEL, probeEmbedding);
} else {
  await probe("input gate (fallback)", geminiGateModel(), () =>
    gateProbe(geminiGateModel()));
  await probe("general-chat generation", generationModelFor("general_education"), () =>
    generationProbe(generationModelFor("general_education")));
  await probe("clarify generation", generationModelFor("screening_clarification"), () =>
    generationProbe(generationModelFor("screening_clarification")));
  await probe("embeddings", EMBEDDING_MODEL, probeEmbedding);
}

async function probeEmbedding(): Promise<string> {
  const response = await fetch(
    `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey!,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: "chronic kidney disease" }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error(await describeFailure(response));
  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `expected ${EMBEDDING_DIMENSION} dims, got ${
        Array.isArray(values) ? values.length : "none"
      }`,
    );
  }
  return `${EMBEDDING_DIMENSION} dims`;
}

// --- Reranker: Cohere -------------------------------------------------------
if (!cohereKey) {
  skip(
    "reranker",
    RERANK_MODEL,
    "COHERE_API_KEY unset — pipeline degrades to cosine ordering (supported)",
  );
} else {
  await probe("reranker", RERANK_MODEL, async () => {
    const response = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cohereKey}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query: "What is chronic kidney disease?",
        documents: [
          "CKD is a long-term condition where the kidneys do not filter blood well.",
          "Bananas are a good source of potassium.",
        ],
        top_n: 2,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(await describeFailure(response));
    const data = await response.json();
    const top = data?.results?.[0];
    if (!top) throw new Error("200 but no results");
    return `top score ${Number(top.relevance_score).toFixed(3)}`;
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("\nBATO provider health\n");
const pad = (s: string, n: number) => s.padEnd(n);
const roleWidth = Math.max(...results.map((r) => r.role.length), 4) + 2;
const modelWidth = Math.max(...results.map((r) => r.model.length), 5) + 2;

for (const r of results) {
  const mark = r.status === "ok" ? "PASS" : r.status === "fail" ? "FAIL" : "skip";
  const timing = r.status === "ok" ? ` (${r.ms}ms)` : "";
  console.log(
    `  ${mark}  ${pad(r.role, roleWidth)}${pad(r.model, modelWidth)}${r.detail}${timing}`,
  );
}

// Bucket collision check. The whole point of the per-role model split is that
// no two Gemini roles share a name; if an env override undoes that, the
// symptom is a mysterious halving of the day's capacity, so name it here.
const geminiRoles = results.filter((r) =>
  r.model.startsWith("gemini-") && r.role !== "embeddings"
);
const seen = new Map<string, string[]>();
for (const r of geminiRoles) {
  seen.set(r.model, [...(seen.get(r.model) ?? []), r.role]);
}
const collisions = [...seen.entries()].filter(([, roles]) => roles.length > 1);
if (collisions.length > 0) {
  console.log("\n  WARNING — these roles share one Gemini model, and therefore");
  console.log("  one 20/day free-tier bucket. Give each its own model:");
  for (const [model, roles] of collisions) {
    console.log(`    ${model}: ${roles.join(", ")}`);
  }
}

const failed = results.filter((r) => r.status === "fail");
console.log(
  `\n  ${results.filter((r) => r.status === "ok").length} ok, ${failed.length} failed, ${
    results.filter((r) => r.status === "skipped").length
  } skipped\n`,
);
if (failed.length > 0) Deno.exit(1);
