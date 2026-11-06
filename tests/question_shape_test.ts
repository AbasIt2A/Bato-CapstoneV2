// Tests for the assessment chat's question-vs-answer router
// (frontend/src/lib/question-shape.ts).
// Run with: deno test --allow-read --allow-env tests/question_shape_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { isQuestionShaped } from "../frontend/src/lib/question-shape.ts";
import { isUnsure, QUESTIONS } from "../supabase/functions/_shared/questions.ts";
import { detectRedirect } from "../supabase/functions/_shared/clarify-redirect.ts";

// Every kind of reply the screening controller accepts or answers with
// guidance. None may be routed to the clarification assistant, or the user's
// answer would never be recorded.
const ACCEPTED_ANSWERS = [
  "yes", "Yes", "YES", "y", "oo", "opo", "oo po", "no", "No", "n", "hindi",
  "hindi po", "dili", "wala",
  "female", "f", "babae", "babaye", "male", "m", "lalaki",
  "54", "54 years old", "70 years", "20",
  "not sure", "Not sure", "unsure", "no idea", "I don't know",
  "I dont remember", "I can't remember", "I cannot recall", "can't remember",
  "cannot recall", "can't say", "forgot", "hindi ko alam", "di ko alam",
  "hindi ko matandaan", "hindi sigurado", "dili sigurado", "ambot",
  "wala ko kabalo",
];

// Answer-SHAPED text the controller may reject, but which must still reach
// it: its validation message ("Please answer yes or no") is the right reply,
// not a clarification.
const ANSWER_SHAPED = [
  "yes.", "No!", "yes?", "no po?", "54?", "yess", "noo", "nope", "nah",
  "yeah", "yep", "sure", "of course", "never", "none", "not really",
  "maybe", "perhaps", "probably", "idk", "dunno", "I think so",
  "I don't think so", "yes I have", "yes, I was diagnosed in 2019",
  "no, never been told", "I have high blood pressure", "I had a stroke",
  "had a stroke in 2015", "was told no", "my doctor said yes", "I'm 54",
  "fifty four", "limampu't apat", "kalim-an ug upat", "54 taon",
  "I'm a woman", "babae ako", "lalaki ko", "may anemia ako", "meron",
  "naa ko", "wala pa", "dili pa", "siguro", "basin", "baka",
  "syempre", "sige", "ok", "okay", "yse", "hmm", "k",
];

Deno.test("question shape: no accepted answer is ever routed as a question", () => {
  for (const a of ACCEPTED_ANSWERS) {
    assertEquals(isQuestionShaped(a), false, a);
  }
});

Deno.test("question shape: the accepted-answer list really is accepted", () => {
  // Guards the test above against drifting into strings nobody types.
  for (const a of ACCEPTED_ANSWERS) {
    const accepted = isUnsure(a) || QUESTIONS.some((q) => q.parse(a).ok);
    assert(accepted, `"${a}" is not an answer any question accepts`);
  }
});

Deno.test("question shape: answer-shaped text still goes to the controller", () => {
  for (const a of ANSWER_SHAPED) {
    assertEquals(isQuestionShaped(a), false, a);
  }
});

Deno.test("question shape: questions and requests reach the assistant", () => {
  const questions = [
    // Regression: no question mark, opens with a request verb (2026-11-06).
    "provide symptions of anemia",
    "provide symptoms of anemia",
    // Request verbs.
    "give me the symptoms", "tell me what anemia is", "list the signs of diabetes",
    "describe peripheral vascular disease", "explain", "please explain",
    "pls explain", "help", "help me", "clarify this", "simplify the question",
    "rephrase that", "repeat the question", "enumerate the symptoms",
    "I want to know about anemia", "I'd like to ask something",
    "I have a question", "quick question", "may I ask something",
    // Questions without a question mark.
    "what is diabetes", "why does this matter", "how do I know",
    "what's anemia", "which one is it", "can you explain this question",
    "could you help", "should I say yes", "is this about my kidneys",
    "does it mean high sugar", "do I count it",
    // Statements of not understanding — opens like an answer, but isn't one.
    "I don't know what anemia is", "not sure what it means",
    "I don't understand", "I'm confused", "never heard of it",
    "I'm not familiar with that term", "no, what does that mean",
    "I have no idea what PVD is", "unclear",
    // Bare terms and topics (asking for a definition).
    "anemia", "proteinuria", "pvd", "ckd", "bp", "high blood pressure",
    "peripheral vascular disease", "congestive heart failure", "protein in urine",
    // Symptoms in any shape or spelling.
    "symptoms", "anemia symptoms", "symptions", "symtoms of anemia",
    "warning signs", "signs of anemia",
    // Asking for more.
    "more about anemia", "information about diabetes", "learn about pvd",
    // Tagalog.
    "ano ang anemia", "anong ibig sabihin nito", "bakit tinatanong ito",
    "paano ko malalaman", "ipaliwanag mo", "pakipaliwanag", "sintomas ng anemia",
    "hindi ko maintindihan", "meron ba akong anemia", "diabetes ba ito",
    "pwede mo ipaliwanag", "ano ang kahulugan ng pvd",
    // Bisaya.
    "unsa ang anemia", "unsay buot ipasabot", "ngano gipangutana ni",
    "giunsa pagkahibalo", "wala ko kasabot", "isulti ang sintomas",
    "mahimo ba nimo ipatin-aw",
  ];
  for (const q of questions) {
    assertEquals(isQuestionShaped(q), true, q);
  }
});

Deno.test("question shape: empty and whitespace are not questions", () => {
  for (const t of ["", "   ", "\n"]) assertEquals(isQuestionShaped(t), false);
});

Deno.test("question shape: a routed symptom request meets the redirect", () => {
  for (const q of ["provide symptions of anemia", "give me the symptoms", "anemia symptoms"]) {
    assert(isQuestionShaped(q), q);
    assertEquals(detectRedirect(q, "anemia")?.reason, "symptoms", q);
  }
});
