// Unit tests for the Rule-Based Screening Controller's pure flow logic
// (ported from the capstone build).
// Run with: deno test --allow-read --allow-env tests/screening_flow_test.ts

import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  evaluateAnswer,
  finalizeAssessment,
  nextStepIndex,
  SCREENING_SEQUENCE,
  stepPayload,
  type StoredResponse,
  TOTAL_STEPS,
} from "../supabase/functions/_shared/screening-flow.ts";

Deno.test("sequence: nine steps in the fixed order", () => {
  assertEquals(TOTAL_STEPS, 9);
  assertEquals(SCREENING_SEQUENCE, [
    "age",
    "female",
    "anemia",
    "hypertension",
    "diabetes",
    "cvd_history",
    "chf_history",
    "pvd",
    "proteinuria",
  ]);
});

Deno.test("stepPayload: exposes prompt/options per step, rejects bad index", () => {
  const first = stepPayload(0);
  assertEquals(first.key, "age");
  assertEquals(first.inputType, "number");
  assertEquals(first.total, 9);

  const last = stepPayload(8);
  assertEquals(last.key, "proteinuria");
  assertEquals(last.options, ["Yes", "No", "Not sure"]);

  assertThrows(() => stepPayload(9), RangeError);
  assertThrows(() => stepPayload(-1), RangeError);
});

Deno.test("nextStepIndex: walks the sequence and detects corrupt state", () => {
  assertEquals(nextStepIndex([]), 0);
  assertEquals(nextStepIndex([{ variable_key: "age", value_raw: "54" }]), 1);

  // Answers out of sequence (skipped a step) must throw, not mis-resume.
  assertThrows(() =>
    nextStepIndex([{ variable_key: "anemia", value_raw: "yes" }])
  );
  // Duplicates must throw.
  assertThrows(() =>
    nextStepIndex([
      { variable_key: "age", value_raw: "54" },
      { variable_key: "age", value_raw: "60" },
    ])
  );
});

Deno.test("evaluateAnswer: age parses, awards tiered points, re-asks on junk", () => {
  const ok = evaluateAnswer("age", " 67 ");
  assertEquals(ok, { ok: true, normalized: "67", points: 3 });

  assertEquals(evaluateAnswer("age", "54 years old"), {
    ok: true,
    normalized: "54",
    points: 2,
  });

  for (const junk of ["abc", "-3", "1200", "54.5", ""]) {
    const bad = evaluateAnswer("age", junk);
    assertEquals(bad.ok, false, `age input: "${junk}"`);
  }
});

Deno.test("evaluateAnswer: yes/no variants and sex mapping", () => {
  assertEquals(evaluateAnswer("diabetes", "YES"), {
    ok: true,
    normalized: "yes",
    points: 1,
  });
  assertEquals(evaluateAnswer("diabetes", "n"), {
    ok: true,
    normalized: "no",
    points: 0,
  });
  assertEquals(evaluateAnswer("female", "Female"), {
    ok: true,
    normalized: "female",
    points: 1,
  });
  assertEquals(evaluateAnswer("female", "m"), {
    ok: true,
    normalized: "male",
    points: 0,
  });
  assertEquals(evaluateAnswer("female", "prefer not to say").ok, false);
  // A clarifying question is not a valid answer — controller re-asks; the
  // LLM side-branch is the frontend's affordance, never this module's.
  assertEquals(evaluateAnswer("anemia", "what does anemia mean?").ok, false);
});

Deno.test("evaluateAnswer: can't-recall answers get explain-or-answer-no guidance", () => {
  // Per the printed SCORED instrument, "not sure" counts as zero. The bot
  // must not just demand yes/no — it offers to explain the term and tells
  // the user to answer "No" if they can't recall (re-ask, not auto-scored).
  for (const unsure of [
    "I dont remember",
    "i can't recall",
    "not sure",
    "I don't know",
    "hindi ko alam",
  ]) {
    const out = evaluateAnswer("anemia", unsure);
    assertEquals(out.ok, false, `anemia input: "${unsure}"`);
    if (!out.ok) {
      assertEquals(out.message.includes('answer "No"'), true);
      assertEquals(out.message.includes("anemia"), true);
    }
  }
});

Deno.test("evaluateAnswer: unsure replies lead with No guidance and can vary", () => {
  const random = Math.random;
  try {
    for (
      const [input, start] of [
        ["I can't recall", /^If you (?:can't recall|don't remember)/],
        ["I dont remember", /^If you (?:can't recall|don't remember)/],
        ["I don't know", /^If you (?:don't know|are unsure)/],
      ] as const
    ) {
      Math.random = () => 0;
      const first = evaluateAnswer("cvd_history", input);
      Math.random = () => 0.99;
      const second = evaluateAnswer("cvd_history", input);
      assertEquals(first.ok, false);
      assertEquals(second.ok, false);
      if (first.ok || second.ok) continue;

      assertNotEquals(first.message, second.message);
      for (const message of [first.message, second.message]) {
        assertMatch(message, start);
        assertMatch(message, /^If [^.]+answer "No"\./);
        assertEquals(message.includes("a heart attack or stroke"), true);
        assertEquals(message.includes("explain"), true);
        assertEquals(message.toLowerCase().includes("unsure"), true);
      }
    }
  } finally {
    Math.random = random;
  }
});

Deno.test('evaluateAnswer: proteinuria accepts "not sure" and scores it 0', () => {
  assertEquals(evaluateAnswer("proteinuria", "Not sure"), {
    ok: true,
    normalized: "not_sure",
    points: 0,
  });
  assertEquals(evaluateAnswer("proteinuria", "yes"), {
    ok: true,
    normalized: "yes",
    points: 1,
  });
  // Free-typed can't-recall phrasing is a valid "not sure" here, since the
  // question itself invites that answer.
  assertEquals(evaluateAnswer("proteinuria", "I dont remember"), {
    ok: true,
    normalized: "not_sure",
    points: 0,
  });
  assertEquals(evaluateAnswer("proteinuria", "maybe").ok, false);
});

function fullResponses(overrides: Record<string, string> = {}): StoredResponse[] {
  const defaults: Record<string, string> = {
    age: "45",
    female: "male",
    anemia: "no",
    hypertension: "no",
    diabetes: "no",
    cvd_history: "no",
    chf_history: "no",
    pvd: "no",
    proteinuria: "not_sure",
  };
  return SCREENING_SEQUENCE.map((key) => ({
    variable_key: key,
    value_raw: overrides[key] ?? defaults[key],
  }));
}

Deno.test("finalizeAssessment: end-to-end totals match scored.ts", () => {
  // All-clear 45-year-old male: 0 → Screen Negative.
  const negative = finalizeAssessment(fullResponses());
  assertEquals(negative.totalScore, 0);
  assertEquals(negative.classification, "Screen Negative");

  // 68-year-old female with diabetes and hypertension: 3+1+1+1 = 6.
  const positive = finalizeAssessment(fullResponses({
    age: "68",
    female: "female",
    diabetes: "yes",
    hypertension: "yes",
  }));
  assertEquals(positive.totalScore, 6);
  assertEquals(positive.classification, "Screen Positive");

  // Boundary: 65-year-old male, nothing else → exactly 3 → Negative.
  const boundary = finalizeAssessment(fullResponses({ age: "65" }));
  assertEquals(boundary.totalScore, 3);
  assertEquals(boundary.classification, "Screen Negative");
});

Deno.test("finalizeAssessment: refuses partial or corrupted assessments", () => {
  assertThrows(() => finalizeAssessment(fullResponses().slice(0, 8)));
  const corrupted = fullResponses();
  corrupted[4] = { variable_key: "diabetes", value_raw: "banana" };
  assertThrows(() => finalizeAssessment(corrupted));
});
