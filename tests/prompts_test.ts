// Prompt-content tests (contract: prompts.ts). Pure, offline, synchronous
// substring checks — no network, no LLM call.
//
// Run with: deno test --allow-read --allow-env tests/prompts_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFLECTION_MESSAGE,
  GENERAL_CHAT_SYSTEM_PROMPT,
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

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: states the CKD-only scope boundary", () => {
  const namesCkd = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "chronic kidney disease") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "CKD");
  const statesBoundary = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "only answer") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "only questions about") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "topic boundary") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "out of scope") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "decline");
  assertEquals(namesCkd, true, "prompt must name CKD/kidney scope");
  assertEquals(statesBoundary, true, "prompt must state the CKD-only boundary");
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
  const forbidden = ["eGFR of", "mL/min", "Stage 3a"];
  for (const phrase of forbidden) {
    assertEquals(
      GENERAL_CHAT_SYSTEM_PROMPT.includes(phrase),
      false,
      `system prompt must not embed CKD content like "${phrase}" — that now comes from retrieval`,
    );
  }
});
