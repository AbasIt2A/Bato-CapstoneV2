// SCORED instrument — deterministic scoring and classification.
// Source: Bang et al. (2007), Table 2. PRD §7.1–7.2.
//
// This module is the only place in the system where a SCORED total or
// classification may be computed. It is a pure function with no I/O and no
// imports; the LLM is never on this path (PRD FR-4, §6.3). Any change here
// must keep scored.test.ts passing in full (PRD §13).

/** The eight binary SCORED variables (age is handled separately, tiered). */
export const BINARY_VARIABLES = [
  "female",
  "anemia",
  "hypertension",
  "diabetes",
  "cvd_history",
  "chf_history",
  "pvd",
  "proteinuria",
] as const;

export type BinaryVariable = (typeof BINARY_VARIABLES)[number];

export interface ScoredInput {
  /** Age in whole years (0–120). */
  age: number;
  female: boolean;
  anemia: boolean;
  hypertension: boolean;
  diabetes: boolean;
  cvd_history: boolean;
  chf_history: boolean;
  pvd: boolean;
  proteinuria: boolean;
}

export type Classification = "Screen Negative" | "Screen Positive";

/** Binary cutoff per Bang et al. (2007); PRD §7.2. Total >= 4 screens positive. */
export const SCREEN_POSITIVE_CUTOFF = 4;

/** Maximum attainable SCORED total (age >= 70 plus all eight binaries). */
export const MAX_SCORE = 12;

export interface ScoredResult {
  totalScore: number;
  classification: Classification;
  /** Points per variable, keyed to match assessment_responses.variable_key. */
  breakdown: { age: number } & Record<BinaryVariable, number>;
}

/** Points for one binary SCORED variable: present → 1, absent → 0 (PRD §7.1). */
export function binaryPoints(present: boolean): 0 | 1 {
  if (typeof present !== "boolean") {
    throw new TypeError(`binary variable must be a boolean, got: ${typeof present}`);
  }
  return present ? 1 : 0;
}

/** Tiered age points per PRD §7.1: <50 → 0, 50–59 → 2, 60–69 → 3, >=70 → 4. */
export function agePoints(age: number): 0 | 2 | 3 | 4 {
  if (!Number.isInteger(age) || age < 0 || age > 120) {
    throw new RangeError(`age must be an integer between 0 and 120, got: ${age}`);
  }
  if (age >= 70) return 4;
  if (age >= 60) return 3;
  if (age >= 50) return 2;
  return 0;
}

/**
 * Computes the SCORED total and binary classification (PRD §7.2).
 *
 * Throws on malformed input rather than coercing: an invalid answer must
 * never silently score as 0 or 1.
 */
export function computeScore(input: ScoredInput): ScoredResult {
  for (const key of BINARY_VARIABLES) {
    if (typeof input[key] !== "boolean") {
      throw new TypeError(`${key} must be a boolean, got: ${typeof input[key]}`);
    }
  }

  const breakdown = {
    age: agePoints(input.age),
    female: binaryPoints(input.female),
    anemia: binaryPoints(input.anemia),
    hypertension: binaryPoints(input.hypertension),
    diabetes: binaryPoints(input.diabetes),
    cvd_history: binaryPoints(input.cvd_history),
    chf_history: binaryPoints(input.chf_history),
    pvd: binaryPoints(input.pvd),
    proteinuria: binaryPoints(input.proteinuria),
  };

  const totalScore = Object.values(breakdown).reduce<number>(
    (sum, p) => sum + p,
    0,
  );

  return {
    totalScore,
    classification: totalScore >= SCREEN_POSITIVE_CUTOFF
      ? "Screen Positive"
      : "Screen Negative",
    breakdown,
  };
}
