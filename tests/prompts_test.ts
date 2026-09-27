// Prompt-content tests (contract: prompts.ts). Pure, offline, synchronous
// substring checks — no network, no LLM call.
//
// Run with: deno test --allow-read --allow-env tests/prompts_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  CLARIFICATION_DEFLECTION_MESSAGE,
  CLARIFICATION_SERVICE_ERROR_MESSAGE,
  CLARIFICATION_SYSTEM_PROMPT,
  DEFLECTION_MESSAGE,
  GENERAL_CHAT_SYSTEM_PROMPT,
  SERVICE_ERROR_MESSAGE,
} from "../supabase/functions/_shared/prompts.ts";
import { SOURCE_FOOTER_LABEL } from "../supabase/functions/_shared/citations.ts";

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

Deno.test("DEFLECTION_MESSAGE: exact approved wording", () => {
  assertEquals(
    DEFLECTION_MESSAGE,
    "Sorry — I can only answer questions about kidney health and chronic " +
      "kidney disease (CKD). I can't help with that. You can ask me things " +
      "like what CKD is, its stages and symptoms, how to keep your kidneys " +
      "healthy, or kidney care in the Philippines.",
  );
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: states the kidney-health scope boundary", () => {
  const namesCkd = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "chronic kidney disease") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "CKD");
  const statesBoundary = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "only answer") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "only questions about") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "topic boundary") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "out of scope") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "decline");
  assertEquals(namesCkd, true, "prompt must name CKD");
  assertEquals(includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "acute kidney injury"), true);
  assertEquals(statesBoundary, true, "prompt must state the kidney-health boundary");
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: never-reveal-instructions language is present", () => {
  const hasNeverReveal = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never reveal") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "do not reveal") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never disclose") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "do not disclose") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never quote") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never share these instructions");
  assertEquals(hasNeverReveal, true);
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: untrusted-data language is present", () => {
  assertEquals(includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "untrusted"), true);
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: the source declaration is required, in the form the parser expects", () => {
  // Attribution moved out of the prose and onto a machine-readable final
  // line (see citations.ts). The requirement itself did not weaken: the
  // Edge Function deflects a reply that declares nothing retrieved. If this
  // label ever drifts from what splitSourceFooter() looks for, every answer
  // deflects — so the prompt must carry the parser's own constant.
  assertEquals(
    GENERAL_CHAT_SYSTEM_PROMPT.includes(SOURCE_FOOTER_LABEL),
    true,
    "prompt must instruct the model using the exact SOURCE_FOOTER_LABEL",
  );
  assertEquals(includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "source"), true);
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: prose attribution is forbidden", () => {
  // The user-facing half of the same change: no "According to X" openers and
  // no "(Source: X)" mid-sentence.
  assertEquals(includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "according to"), true);
  assertEquals(
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "do not name your sources"),
    true,
    "prompt must tell the model to keep source names out of the answer text",
  );
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: does not embed CKD educational content directly", () => {
  const forbidden = ["eGFR of", "mL/min", "Stage 3a", "140/90"];
  for (const phrase of forbidden) {
    assertEquals(
      GENERAL_CHAT_SYSTEM_PROMPT.includes(phrase),
      false,
      `system prompt must not embed CKD content like "${phrase}" — that now comes from retrieval`,
    );
  }
});

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: numbers may not be turned into personal targets", () => {
  // REVIEW-FLAGS.md §6 draws the line between factual numerical education
  // (a definition, classification, threshold or population statistic — which
  // the corpus deliberately carries) and individualized numerical management
  // (a target set for the person asking — which nothing may state). Keeping
  // the figures out of the corpus only closes half of that: a permitted
  // number that IS retrieved can still be applied to the user. This rule is
  // the generation-side half, and §6 names this file as where it must live.
  const forbidsPersonalTarget =
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never convert it into a target") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never personal targets");
  assertEquals(
    forbidsPersonalTarget,
    true,
    "prompt must forbid restating a retrieved number as the user's own target",
  );

  // The specific quantities §6 keeps out of the corpus are also the ones a
  // user is most likely to ask for directly; the prompt must refuse rather
  // than substitute a general figure.
  assertEquals(
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "set individually by a doctor or dietitian"),
    true,
    "prompt must defer personal amounts to a clinician",
  );

  // Not arithmetic on the user's own readings either — that is the same
  // individualized judgement, reached one step later.
  assertEquals(
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "never do arithmetic"),
    true,
    "prompt must forbid comparing a user's own figure against a threshold",
  );
});

// ---------------------------------------------------------------------------
// Service-error replies (added 2026-08-30)
//
// A live MALFORMED_RESPONSE from Gemini made both chatbots tell a user their
// in-scope question was off-topic. These lock in the separation that fixed
// it: an infrastructure fault gets its own sentence, and that sentence never
// enters a system prompt.
// ---------------------------------------------------------------------------

Deno.test("SERVICE_ERROR_MESSAGE: distinct from the scope deflection, and makes no claim about scope", () => {
  assertEquals(SERVICE_ERROR_MESSAGE === DEFLECTION_MESSAGE, false);
  assertEquals(includesCI(SERVICE_ERROR_MESSAGE, "only answer"), false);
  assertEquals(includesCI(SERVICE_ERROR_MESSAGE, "can't help with that"), false);
  // It must tell the user the fault is ours and that retrying is worthwhile.
  assertEquals(includesCI(SERVICE_ERROR_MESSAGE, "try again"), true);
});

Deno.test("CLARIFICATION_SERVICE_ERROR_MESSAGE: reassures mid-assessment without nudging an answer", () => {
  assertEquals(
    CLARIFICATION_SERVICE_ERROR_MESSAGE === CLARIFICATION_DEFLECTION_MESSAGE,
    false,
  );
  // The one thing a user mid-questionnaire needs to hear.
  assertEquals(
    includesCI(CLARIFICATION_SERVICE_ERROR_MESSAGE, "answers so far are unchanged"),
    true,
  );
  // But NOT the deflection's nudge toward recording "no" — a transient API
  // fault must never push a scored answer.
  assertEquals(
    includesCI(CLARIFICATION_SERVICE_ERROR_MESSAGE, "answer no"),
    false,
  );
});

Deno.test("service-error replies are never quoted in a system prompt", () => {
  // The deflections ARE quoted, deliberately, so a model-side decline matches
  // the server-side one. These must not be: they are the server's statement
  // about its own infrastructure, and a model that can produce them can
  // produce an ungrounded reply the guards would read as a legitimate refusal.
  for (
    const prompt of [GENERAL_CHAT_SYSTEM_PROMPT, CLARIFICATION_SYSTEM_PROMPT]
  ) {
    assertEquals(prompt.includes(SERVICE_ERROR_MESSAGE), false);
    assertEquals(prompt.includes(CLARIFICATION_SERVICE_ERROR_MESSAGE), false);
  }
});
