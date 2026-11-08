// Tests for the Clarification Engine's symptom / reading / self-assessment
// redirect (supabase/functions/_shared/clarify-redirect.ts), and for the two
// corpus files removed from the clarification scope alongside it.
// Run with: deno test --allow-read --allow-env tests/clarify_redirect_test.ts

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { detectRedirect } from "../supabase/functions/_shared/clarify-redirect.ts";
import { CLARIFICATION_SYSTEM_PROMPT } from "../supabase/functions/_shared/prompts.ts";

const CONDITION_KEYS = [
  "anemia",
  "hypertension",
  "diabetes",
  "cvd_history",
  "chf_history",
  "pvd",
  "proteinuria",
] as const;

// ---------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------

Deno.test("redirect: the anemia symptoms reply is the approved wording", () => {
  const r = detectRedirect("What are some of the symptoms of anemia", "anemia");
  assertEquals(r?.reason, "symptoms");
  assertEquals(r?.condition, "anemia");
  assertEquals(
    r?.reply,
    "This question is about whether a doctor or health worker has told you " +
      "that you have anemia, not about symptoms. Symptoms like tiredness have " +
      "many causes, so they can't tell you whether you have it. If you're not " +
      "sure, the screening asks you to answer no. You can ask about anemia " +
      "symptoms in KidneyLearn after you finish.",
  );
});

Deno.test("redirect: every condition question gets its own reply, for every reason", () => {
  const asks = {
    symptoms: "what are the symptoms?",
    reading: "what counts as a high level?",
    self_assessment: "how would I know if I have it?",
  };
  for (const key of CONDITION_KEYS) {
    for (const [reason, question] of Object.entries(asks)) {
      const r = detectRedirect(question, key);
      assertEquals(r?.reason, reason, `${key}/${reason}`);
      assertEquals(r?.condition, key, `${key}/${reason}`);
      assertMatch(r!.reply, /^This question is about whether /);
      assertMatch(r!.reply, /KidneyLearn after you finish\.$/);
    }
  }
});

Deno.test("redirect: proteinuria keeps its own not-sure answer", () => {
  const r = detectRedirect("what are the signs of protein in urine?", "proteinuria");
  assertMatch(r!.reply, /answer "not sure"/);
  assertEquals(r!.reply.includes("answer no"), false);
  // Every yes/no condition tells an unsure user to answer no.
  for (const key of CONDITION_KEYS.filter((k) => k !== "proteinuria")) {
    assertMatch(detectRedirect("symptoms?", key)!.reply, /answer no\./, key);
  }
});

Deno.test("redirect: only anemia names an example symptom", () => {
  assertMatch(detectRedirect("symptoms?", "anemia")!.reply, /tiredness/);
  for (const key of CONDITION_KEYS.filter((k) => k !== "anemia")) {
    assertEquals(detectRedirect("symptoms?", key)!.reply.includes("tiredness"), false, key);
  }
});

Deno.test("redirect: no reply ever names a symptom list or a threshold", () => {
  const forbidden = /foamy|swelling|cramp|pale|dizz|thirst|chest pain|\d{2,3}\s*\/\s*\d{2,3}|mmhg|mg\/dl/i;
  for (const key of [...CONDITION_KEYS, "age", "female", undefined]) {
    for (const q of ["symptoms?", "what counts as high?", "do I have it?"]) {
      const r = detectRedirect(q, key);
      assert(r, `${String(key)}: ${q}`);
      assertEquals(forbidden.test(r.reply), false, r.reply);
    }
  }
});

// ---------------------------------------------------------------------------
// Which condition
// ---------------------------------------------------------------------------

Deno.test("redirect: a condition named in the question wins over the current step", () => {
  assertEquals(detectRedirect("what are the symptoms of diabetes?", "anemia")?.condition, "diabetes");
  assertEquals(detectRedirect("signs of heart failure?", "cvd_history")?.condition, "chf_history");
  assertEquals(detectRedirect("signs of a stroke?", "anemia")?.condition, "cvd_history");
  assertEquals(detectRedirect("Is foamy urine a sign of protein in the urine?", "anemia")?.condition, "proteinuria");
  assertEquals(detectRedirect("sintomas ng altapresyon", "diabetes")?.condition, "hypertension");
});

Deno.test("redirect: kidney or no condition at all falls back to the general reply", () => {
  for (const [q, key] of [
    ["What are the symptoms of CKD?", "anemia"],
    ["what are the symptoms?", "age"],
    ["what are the symptoms?", "female"],
    ["what are the symptoms?", undefined],
    ["what are the symptoms?", "not-a-key"],
  ] as const) {
    const r = detectRedirect(q, key);
    assertEquals(r?.condition, null, `${q} @ ${key}`);
    assertMatch(r!.reply, /^This screening asks about conditions/);
  }
});

// ---------------------------------------------------------------------------
// What is redirected, and what is not
// ---------------------------------------------------------------------------

Deno.test("redirect: symptom, reading and self-assessment questions are caught", () => {
  const caught: [string, string][] = [
    ["What are some of the symptoms of anemia", "symptoms"],
    ["anemia symptoms", "symptoms"],
    ["what are the warning signs?", "symptoms"],
    ["I feel tired a lot, is that it?", "symptoms"],
    ["Ano ang sintomas nito?", "symptoms"],
    ["unsa ang timailhan?", "symptoms"],
    ["what blood pressure counts as high?", "reading"],
    ["my blood pressure was 145/92 yesterday", "reading"],
    ["what is a normal blood sugar?", "reading"],
    ["my sugar level was 180, is that diabetes?", "reading"],
    ["Do I have anemia?", "self_assessment"],
    ["could I have diabetes without knowing?", "self_assessment"],
    ["am i diabetic?", "self_assessment"],
    ["How would I know if I have it?", "self_assessment"],
    ["Meron ba akong anemia?", "self_assessment"],
  ];
  for (const [q, reason] of caught) {
    assertEquals(detectRedirect(q, "anemia")?.reason, reason, q);
  }
});

Deno.test("redirect: definitions, why-it-matters, and form questions pass through", () => {
  const passed = [
    "What is diabetes?",
    "What does anemia mean?",
    "Why does this matter?",
    "Can you explain this question in simple words?",
    'What does this screening question mean: "Have you been diagnosed with diabetes (high blood sugar)?"?',
    "Why does this screening ask my age, and what does age have to do with kidney health?",
    "Is anemia a sign of kidney disease?",
    "Can high blood pressure be a sign of kidney problems?",
    "Is anemia a symptom of CKD?",
    "Do I have to answer yes?",
    "what is peripheral vascular disease?",
  ];
  for (const q of passed) {
    assertEquals(detectRedirect(q, "anemia"), null, q);
  }
});

// ---------------------------------------------------------------------------
// Second layer and corpus scope
// ---------------------------------------------------------------------------

Deno.test("clarification prompt forbids symptoms, thresholds and self-assessment", () => {
  assertMatch(CLARIFICATION_SYSTEM_PROMPT, /Never list symptoms, signs, or warning signs/);
  assertMatch(CLARIFICATION_SYSTEM_PROMPT, /never give a number or threshold/);
  assertMatch(CLARIFICATION_SYSTEM_PROMPT, /never a symptom or a feeling/);
});

Deno.test("symptom and threshold files are not in the clarification scope", async () => {
  for (
    const file of [
      "knowledge/official-health-body/niddk/symptoms-causes-complications.md",
      "knowledge/clinical-guidelines/psh/high-blood-pressure-in-the-philippines.md",
    ]
  ) {
    const text = await Deno.readTextFile(file);
    const scopes = text.match(/^scopes:\s*\[(.*)\]\s*$/m)?.[1];
    assert(scopes, `${file} has no scopes line`);
    assertEquals(scopes.includes("screening_clarification"), false, file);
    assertEquals(scopes.includes("general_education"), true, file);
  }
});
