// Rule-Based Screening Controller — pure flow logic (PRD §6.3A, FR-2, FR-4).
//
// This module is the deterministic state machine that owns the SCORED flow:
// which question is current, whether an answer is valid, how many points it
// earns, and the final score/classification. It has no I/O; the screening
// Edge Function (functions/screening/index.ts) is HTTP/DB glue around it.
//
// It imports only questions.ts (wording + parsing) and scored.ts (scoring).
// Nothing here may ever import the LLM client.

import { getQuestion, QUESTIONS, type QuestionSpec } from "./questions.ts";
import {
  agePoints,
  binaryPoints,
  computeScore,
  type ScoredInput,
  type ScoredResult,
} from "./scored.ts";

/** The fixed question order (PRD §7.1 order, asked one at a time per FR-2). */
export const SCREENING_SEQUENCE: ReadonlyArray<QuestionSpec["key"]> = QUESTIONS
  .map((q) => q.key);

export const TOTAL_STEPS = SCREENING_SEQUENCE.length; // 9

export interface StoredResponse {
  variable_key: string;
  value_raw: string;
}

export interface StepPayload {
  index: number; // 0-based
  total: number;
  key: QuestionSpec["key"];
  prompt: string;
  inputType: QuestionSpec["inputType"];
  options?: string[];
}

export function stepPayload(index: number): StepPayload {
  if (index < 0 || index >= TOTAL_STEPS) {
    throw new RangeError(`step index out of range: ${index}`);
  }
  const q = getQuestion(SCREENING_SEQUENCE[index]);
  return {
    index,
    total: TOTAL_STEPS,
    key: q.key,
    prompt: q.prompt,
    inputType: q.inputType,
    ...(q.options ? { options: q.options } : {}),
  };
}

/**
 * Index of the next unanswered question given the stored responses.
 * Verifies the responses are exactly the first N of the fixed sequence —
 * anything else means the DB state was tampered with or corrupted.
 */
export function nextStepIndex(responses: StoredResponse[]): number {
  if (responses.length > TOTAL_STEPS) {
    throw new Error(`too many responses: ${responses.length}`);
  }
  const answered = new Set(responses.map((r) => r.variable_key));
  if (answered.size !== responses.length) {
    throw new Error("duplicate variable_key in stored responses");
  }
  for (let i = 0; i < responses.length; i++) {
    if (!answered.has(SCREENING_SEQUENCE[i])) {
      throw new Error(
        `stored responses are not a prefix of the screening sequence (missing ${
          SCREENING_SEQUENCE[i]
        })`,
      );
    }
  }
  return responses.length;
}

export type AnswerOutcome =
  | { ok: true; normalized: string; points: number }
  | { ok: false; message: string };

/**
 * Validates one raw answer for one variable and, if valid, awards its points
 * via the scored.ts module (never computed here).
 */
export function evaluateAnswer(
  key: QuestionSpec["key"],
  raw: string,
): AnswerOutcome {
  const parsed = getQuestion(key).parse(raw);
  if (!parsed.ok) return parsed;
  const points = key === "age"
    ? agePoints(parsed.value as number)
    : binaryPoints(parsed.value as boolean);
  return { ok: true, normalized: parsed.normalized, points };
}

/**
 * Rebuilds the typed ScoredInput from the stored raw answers of a fully
 * answered assessment. Throws if anything is missing or no longer parses —
 * a partial or corrupted assessment must never reach scoring.
 */
export function buildScoredInput(responses: StoredResponse[]): ScoredInput {
  if (nextStepIndex(responses) !== TOTAL_STEPS) {
    throw new Error(
      `assessment is not fully answered: ${responses.length}/${TOTAL_STEPS}`,
    );
  }
  const byKey = new Map(responses.map((r) => [r.variable_key, r.value_raw]));
  const typed: Record<string, number | boolean> = {};
  for (const key of SCREENING_SEQUENCE) {
    const parsed = getQuestion(key).parse(byKey.get(key)!);
    if (!parsed.ok) {
      throw new Error(`stored answer for ${key} does not parse`);
    }
    typed[key] = parsed.value;
  }
  return typed as unknown as ScoredInput;
}

/** Final score + classification for a fully answered assessment (PRD §7.2). */
export function finalizeAssessment(responses: StoredResponse[]): ScoredResult {
  return computeScore(buildScoredInput(responses));
}
