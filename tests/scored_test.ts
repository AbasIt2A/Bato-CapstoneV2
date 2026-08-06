// Unit tests for the SCORED scoring module (ported from the capstone build).
//
// This suite is exhaustive by construction: every combination of the four
// age tiers and all 2^8 binary-variable states (1,024 inputs) is checked
// against an independently computed expected total, in addition to
// hand-computed known cases and boundary cases at the classification cutoff.
//
// Run with: deno test --allow-read --allow-env tests/scored_test.ts

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  agePoints,
  BINARY_VARIABLES,
  binaryPoints,
  computeScore,
  MAX_SCORE,
  SCREEN_POSITIVE_CUTOFF,
  type ScoredInput,
} from "../supabase/functions/_shared/scored.ts";

function makeInput(age: number, flags: Partial<ScoredInput> = {}): ScoredInput {
  return {
    age,
    female: false,
    anemia: false,
    hypertension: false,
    diabetes: false,
    cvd_history: false,
    chf_history: false,
    pvd: false,
    proteinuria: false,
    ...flags,
  };
}

// ---------------------------------------------------------------------------
// Age tier boundaries
// ---------------------------------------------------------------------------
Deno.test("agePoints: every tier boundary", () => {
  const cases: Array<[number, number]> = [
    [0, 0], [18, 0], [49, 0],   // <50 → 0
    [50, 2], [55, 2], [59, 2],  // 50–59 → 2
    [60, 3], [65, 3], [69, 3],  // 60–69 → 3
    [70, 4], [85, 4], [120, 4], // >=70 → 4
  ];
  for (const [age, expected] of cases) {
    assertEquals(agePoints(age), expected, `age ${age}`);
  }
});

Deno.test("binaryPoints: present → 1, absent → 0, non-boolean throws", () => {
  assertEquals(binaryPoints(true), 1);
  assertEquals(binaryPoints(false), 0);
  for (const bad of ["yes", 1, null, undefined]) {
    // deno-lint-ignore no-explicit-any
    assertThrows(() => binaryPoints(bad as any), TypeError, undefined, String(bad));
  }
});

Deno.test("agePoints: rejects out-of-range and non-integer input", () => {
  for (const bad of [-1, 121, 45.5, NaN, Infinity, -Infinity]) {
    assertThrows(() => agePoints(bad), RangeError, undefined, `age ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// Exhaustive sweep: 4 age tiers × 2^8 binary combinations = 1,024 cases.
// Expected totals are computed independently of the implementation.
// ---------------------------------------------------------------------------
Deno.test("computeScore: all 1,024 variable combinations", () => {
  const ageTiers: Array<[number, number]> = [[30, 0], [55, 2], [65, 3], [75, 4]];
  let casesChecked = 0;

  for (const [age, expectedAgePoints] of ageTiers) {
    for (let mask = 0; mask < 1 << BINARY_VARIABLES.length; mask++) {
      const flags: Partial<ScoredInput> = {};
      let expectedBinaryPoints = 0;
      BINARY_VARIABLES.forEach((key, bit) => {
        const present = (mask & (1 << bit)) !== 0;
        flags[key] = present;
        if (present) expectedBinaryPoints += 1;
      });

      const expectedTotal = expectedAgePoints + expectedBinaryPoints;
      const result = computeScore(makeInput(age, flags));

      assertEquals(
        result.totalScore,
        expectedTotal,
        `age ${age}, mask ${mask.toString(2).padStart(8, "0")}`,
      );
      assertEquals(
        result.classification,
        expectedTotal >= SCREEN_POSITIVE_CUTOFF
          ? "Screen Positive"
          : "Screen Negative",
        `classification at total ${expectedTotal}`,
      );
      casesChecked++;
    }
  }
  assertEquals(casesChecked, 1024);
});

// ---------------------------------------------------------------------------
// Hand-computed known cases
// ---------------------------------------------------------------------------
Deno.test("computeScore: hand-computed cases", () => {
  // Young, no risk factors: minimum score.
  assertEquals(computeScore(makeInput(25)).totalScore, 0);
  assertEquals(computeScore(makeInput(25)).classification, "Screen Negative");

  // 68-year-old female with diabetes and hypertension: 3+1+1+1 = 6.
  const r = computeScore(
    makeInput(68, { female: true, diabetes: true, hypertension: true }),
  );
  assertEquals(r.totalScore, 6);
  assertEquals(r.classification, "Screen Positive");

  // 52-year-old male with anemia only: 2+1 = 3 → still negative.
  assertEquals(
    computeScore(makeInput(52, { anemia: true })).classification,
    "Screen Negative",
  );

  // 45-year-old female with proteinuria and PVD: 0+1+1+1 = 3 → negative.
  assertEquals(
    computeScore(makeInput(45, { female: true, proteinuria: true, pvd: true }))
      .totalScore,
    3,
  );

  // Oldest tier with every risk factor: the maximum score, 12.
  const max = computeScore(makeInput(90, {
    female: true,
    anemia: true,
    hypertension: true,
    diabetes: true,
    cvd_history: true,
    chf_history: true,
    pvd: true,
    proteinuria: true,
  }));
  assertEquals(max.totalScore, MAX_SCORE);
  assertEquals(max.classification, "Screen Positive");
});

// ---------------------------------------------------------------------------
// Classification cutoff boundary (0–3 negative, >=4 positive)
// ---------------------------------------------------------------------------
Deno.test("computeScore: cutoff boundary at exactly 3 vs exactly 4", () => {
  // Exactly 3: age 60–69 alone.
  const three = computeScore(makeInput(65));
  assertEquals(three.totalScore, 3);
  assertEquals(three.classification, "Screen Negative");

  // Exactly 4 via age alone: >=70.
  const fourByAge = computeScore(makeInput(70));
  assertEquals(fourByAge.totalScore, 4);
  assertEquals(fourByAge.classification, "Screen Positive");

  // Exactly 4 via binaries alone, no age points.
  const fourByBinaries = computeScore(makeInput(40, {
    female: true,
    anemia: true,
    diabetes: true,
    hypertension: true,
  }));
  assertEquals(fourByBinaries.totalScore, 4);
  assertEquals(fourByBinaries.classification, "Screen Positive");
});

// ---------------------------------------------------------------------------
// Breakdown integrity: per-variable points sum to the total and match
// what the controller will write to assessment_responses.points_awarded.
// ---------------------------------------------------------------------------
Deno.test("computeScore: breakdown sums to totalScore and respects per-variable bounds", () => {
  const result = computeScore(makeInput(72, {
    female: true,
    chf_history: true,
    proteinuria: true,
  }));
  const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
  assertEquals(sum, result.totalScore);
  assertEquals(result.breakdown.age, 4);
  for (const key of BINARY_VARIABLES) {
    const points = result.breakdown[key];
    assertEquals(points === 0 || points === 1, true, `${key} points 0/1`);
  }
});

// ---------------------------------------------------------------------------
// Malformed input must throw, never silently score
// ---------------------------------------------------------------------------
Deno.test("computeScore: rejects non-boolean variable values", () => {
  for (const bad of ["yes", 1, null, undefined]) {
    const input = makeInput(55);
    // deno-lint-ignore no-explicit-any
    (input as any).diabetes = bad;
    assertThrows(() => computeScore(input), TypeError, undefined, String(bad));
  }
});

Deno.test("computeScore: is deterministic for identical input", () => {
  const input = makeInput(61, { hypertension: true, anemia: true });
  assertEquals(computeScore(input), computeScore(input));
});
