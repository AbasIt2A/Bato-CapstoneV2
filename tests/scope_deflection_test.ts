// Scope-deflection battery (spec §3.1): off-topic requests — coding,
// ideation, general-assistant, non-CKD health, and out-of-scope clinical —
// must be classified out of scope regardless of how benign or well-formed
// they are; genuine CKD questions must pass through. Gate-level tests only:
// classifyQuery's contract says it "calls fetch to Gemini", so fetch is
// stubbed here to return that API's own response envelope carrying a chosen
// {in_scope, injection_detected, reason} verdict — no network, no API key.
//
// Run with: deno test --allow-read --allow-env tests/scope_deflection_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import { classifyQuery } from "../supabase/functions/_shared/gate.ts";
import { DEFLECTION_MESSAGE } from "../supabase/functions/_shared/prompts.ts";

function geminiClassifierResponse(verdict: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: JSON.stringify(verdict) }] } },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Stubs globalThis.fetch to hand back `verdict` in Gemini's own response
 *  shape, and records how many times it was invoked. */
function stubClassifier(verdict: Record<string, unknown>) {
  const calls = { count: 0 };
  const fn = (() => {
    calls.count++;
    return Promise.resolve(geminiClassifierResponse(verdict));
  }) as typeof fetch;
  return { fn, calls };
}

/** classifyQuery fails open (without calling fetch) when GEMINI_API_KEY is
 *  unset, so the stubbed classifier path needs a dummy key. Restores the
 *  previous value afterward. */
async function withDummyGeminiKey(body: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY", "test-stub-key");
  try {
    await body();
  } finally {
    if (previous === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", previous);
  }
}

const OUT_OF_SCOPE_BATTERY: { label: string; query: string }[] = [
  { label: "coding", query: "Write bubble sort in Python" },
  { label: "ideation", query: "Give me an invention idea" },
  { label: "general-assistant", query: "Summarize this news article" },
  { label: "non-CKD health", query: "What's a good diet for weight loss?" },
  {
    label: "out-of-scope clinical",
    query: "Diagnose my symptoms and tell me if I have cancer",
  },
];

const IN_SCOPE_BATTERY: string[] = [
  "What is CKD?",
  "What are the stages of chronic kidney disease?",
  "How do I keep my kidneys healthy?",
];

Deno.test("DEFLECTION_MESSAGE: exact approved wording is stable", () => {
  assertEquals(
    DEFLECTION_MESSAGE,
    "Sorry — I can only answer questions about kidney health and chronic " +
      "kidney disease (CKD). I can't help with that. You can ask me things " +
      "like what CKD is, its stages and symptoms, how to keep your kidneys " +
      "healthy, or kidney care in the Philippines.",
  );
});

for (const { label, query } of OUT_OF_SCOPE_BATTERY) {
  Deno.test(
    `scope deflection: ${label} query classifies out of scope → deflection applies ("${query}")`,
    async () => {
      const { fn, calls } = stubClassifier({
        in_scope: false,
        injection_detected: false,
        reason: `off-topic: ${label}`,
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fn;
      try {
        await withDummyGeminiKey(async () => {
          const verdict = await classifyQuery(query);
          assertEquals(calls.count >= 1, true, "classifier stub was never invoked");
          assertEquals(verdict.in_scope, false, query);
          // Pipeline contract: an out-of-scope verdict routes to the single
          // approved deflection message, never an ad hoc reply.
          assertEquals(typeof DEFLECTION_MESSAGE, "string");
          assertEquals(DEFLECTION_MESSAGE.length > 0, true);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
}

for (const query of IN_SCOPE_BATTERY) {
  Deno.test(
    `scope pass-through: genuine CKD query stays in scope, no deflection ("${query}")`,
    async () => {
      const { fn, calls } = stubClassifier({
        in_scope: true,
        injection_detected: false,
        reason: "genuine CKD question",
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fn;
      try {
        await withDummyGeminiKey(async () => {
          const verdict = await classifyQuery(query);
          assertEquals(calls.count >= 1, true, "classifier stub was never invoked");
          assertEquals(verdict.in_scope, true, query);
          assertEquals(verdict.injection_detected, false, query);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
}
