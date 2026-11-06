// Tests for the Clarification Engine's diagnostic-language output filter
// (ported from the capstone build). Kept separate from output_guard_test.ts,
// which covers the General CKD Chatbot's injection-fallout guard.
// Run with: deno test --allow-read --allow-env tests/topic_filter_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  filterAssistantReply,
  SAFE_FALLBACK_REPLY,
} from "../supabase/functions/_shared/topic-filter.ts";

Deno.test("blocks diagnostic claims", () => {
  const blocked = [
    "Based on your answers, you have chronic kidney disease.",
    "You probably have CKD and should start treatment.",
    "I diagnose you with kidney failure.",
    "Your diagnosis is stage 3 CKD.",
    "You don't have kidney disease, no need to see a doctor.",
    "You probably have a kidney stone.",
    "There is a 70% chance that you have CKD.",
    // "because"/"since" assert the diagnosis as fact rather than supposing
    // it, so they must stay blocked even though other conjunctions are
    // exempt — this pins that distinction.
    "Because you have CKD, you should start dialysis soon.",
    // The "know" exemption must not let the assistant claim the knowledge.
    "I know you have diabetes.",
    "We think you probably have kidney disease.",
    "I can tell that you have hypertension.",
    // "shows" stays blocked: it follows "your test" as easily as "a test".
    "Your test shows you have diabetes.",
  ];
  for (const text of blocked) {
    const result = filterAssistantReply(text);
    assertEquals(result.ok, false, text);
    assertEquals(result.reply, SAFE_FALLBACK_REPLY);
  }
});

Deno.test("passes normal screening/awareness language", () => {
  const allowed = [
    "Anemia means having too few healthy red blood cells. When you're ready, just answer the question above.",
    "A Screen Positive result means a confirmatory test with a health professional is recommended — it is not a diagnosis.",
    "High blood pressure is one of the two leading causes of CKD.",
    "People who have diabetes have a higher risk of kidney disease, so regular check-ups help.",
    "At the cutoff of 4, the tool's sensitivity is about 92% — that describes the tool across a population, not any individual.",
    // Reported/conditional speech — quoting the screening question is not a
    // diagnostic claim (regression case from live prompt testing).
    "The question is asking if a doctor or health worker has ever told you that you have anemia.",
    "It asks whether you have hypertension — that means high blood pressure.",
    "If you have diabetes, regular kidney check-ups are recommended.",
    "If you have a kidney stone, a clinician can explain your treatment options.",
    // Generic/conditional "you" — how health education addresses a reader in
    // general, not a claim about this user. These are the phrasings grounded
    // educational answers actually produce; both tripped the filter before
    // the conjunction list was widened (2026-08-07), which would have
    // silently deflected legitimate general-chat replies.
    "When you have CKD, your kidneys do not filter blood as well as they should.",
    "Once you have kidney disease, it usually does not go away.",
    "Unless you have kidney failure, dialysis is not normally needed.",
    "While you have CKD, your doctor will monitor your blood pressure.",
    // Verbs of finding out — how a clarification explains the question.
    // Regression: a valid "What is diabetes?" reply was blocked on
    // "know you have diabetes" (2026-11-06).
    "Most people usually know you have diabetes only after a blood test, so you would know you have diabetes because a doctor told you.",
    "You may find out you have diabetes from a routine blood sugar test.",
    "Many people only learn they have it later; you might learn that you have anemia from a blood test.",
    "If a doctor said you have high blood pressure, that counts.",
  ];
  for (const text of allowed) {
    const result = filterAssistantReply(text);
    assertEquals(result.ok, true, text);
    assertEquals(result.reply, text);
  }
});
