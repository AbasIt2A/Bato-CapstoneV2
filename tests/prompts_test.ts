// Prompt-content tests (contract: prompts.ts). Pure, offline, synchronous
// substring checks — no network, no LLM call.
//
// Run with: deno test --allow-read --allow-env tests/prompts_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFLECTION_MESSAGE,
  GENERAL_CHAT_SYSTEM_PROMPT,
} from "../supabase/functions/_shared/prompts.ts";

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

Deno.test("GENERAL_CHAT_SYSTEM_PROMPT: a citation requirement is present", () => {
  const hasCitation = includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "cite") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "citation") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "name the source") ||
    includesCI(GENERAL_CHAT_SYSTEM_PROMPT, "source of each");
  assertEquals(hasCitation, true);
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
