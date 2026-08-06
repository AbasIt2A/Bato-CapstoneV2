// SCORED screening questions — user-facing wording and input validation.
//
// ⚠️ DRAFT WORDING (PRD §7.4, §15.5): every prompt below is an original
// plain-language paraphrase written for BATO. It must be reviewed against the
// AstraZeneca Philippines license terms (Veeva PH-6850) before launch. It is
// intentionally NOT the published Figure 2 questionnaire text.
//
// Parsing here is deterministic string handling only — no LLM. If a user's
// input doesn't validate, the controller re-asks; if they need the term
// explained, the frontend offers the LLM Clarification Engine as a
// side-branch (PRD §6.3) and returns to this same step.

export type ParseResult =
  | { ok: true; normalized: string; value: number | boolean }
  | { ok: false; message: string };

export interface QuestionSpec {
  /** Matches assessment_responses.variable_key and the scored.ts breakdown. */
  key:
    | "age"
    | "female"
    | "anemia"
    | "hypertension"
    | "diabetes"
    | "cvd_history"
    | "chf_history"
    | "pvd"
    | "proteinuria";
  /** DRAFT user-facing prompt (see header note). */
  prompt: string;
  inputType: "number" | "choice";
  /** Quick-reply options the UI should render (choice questions only). */
  options?: string[];
  parse: (raw: string) => ParseResult;
}

const YES = new Set(["yes", "y", "oo"]);
const NO = new Set(["no", "n", "hindi"]);

// "I'm not sure / I can't remember" phrasings, incl. common Tagalog/Bisaya.
// Kept as a regex so free-typed sentences like "I dont remember" match.
const UNSURE_SHAPE =
  /\b(not[\s_]?sure|unsure|no idea|forgot(ten)?|(do|did|to)n'?t\s+(know|remember|recall|think so)|can('?|no)t\s+(remember|recall|say)|hindi\s+ko\s+(alam|matandaan)|di\s+ko\s+alam|wala\s+ko('y|y)?\s+kabalo|ambot)\b/i;

export function isUnsure(raw: string): boolean {
  return UNSURE_SHAPE.test(raw.trim());
}

function normalizeRaw(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Yes/no parser for the history questions. The printed SCORED instrument
 * instructs "if a statement is not true or you are not sure, put a zero" —
 * so when someone says they can't remember, we don't just demand yes/no:
 * we offer an explanation of the term, and tell them that if they still
 * can't recall ever being told this, they should answer "No".
 */
function makeYesNoParser(topic: string) {
  return function parseYesNo(raw: string): ParseResult {
    const v = normalizeRaw(raw);
    if (YES.has(v)) return { ok: true, normalized: "yes", value: true };
    if (NO.has(v)) return { ok: true, normalized: "no", value: false };
    if (isUnsure(raw)) {
      return {
        ok: false,
        message:
          `That's okay — if you're not sure what ${topic} means, just ask and I can explain it first. ` +
          'But if you simply can\'t remember ever being told this by a doctor or health worker, please answer "No" — ' +
          "this screening counts an unsure answer the same as a no.",
      };
    }
    return {
      ok: false,
      message:
        'Please answer "yes" or "no". If you are not sure what this question means, you can ask me to explain it first.',
    };
  };
}

export const QUESTIONS: QuestionSpec[] = [
  {
    key: "age",
    prompt:
      "To get started: how old are you? Please type your age in years (for example, 54).",
    inputType: "number",
    parse: (raw) => {
      const v = normalizeRaw(raw).replace(/\s*(years?( old)?|y\/?o)$/i, "").trim();
      if (!/^\d{1,3}$/.test(v)) {
        return {
          ok: false,
          message: "Please enter your age as a whole number, for example 54.",
        };
      }
      const age = Number(v);
      if (age < 1 || age > 120) {
        return {
          ok: false,
          message: "That age doesn't look right. Please enter a number between 1 and 120.",
        };
      }
      return { ok: true, normalized: String(age), value: age };
    },
  },
  {
    key: "female",
    prompt:
      "What sex were you assigned at birth? This matters because kidney disease risk differs between males and females.",
    inputType: "choice",
    options: ["Male", "Female"],
    parse: (raw) => {
      const v = normalizeRaw(raw);
      if (v === "female" || v === "f") return { ok: true, normalized: "female", value: true };
      if (v === "male" || v === "m") return { ok: true, normalized: "male", value: false };
      return {
        ok: false,
        message: 'Please answer "male" or "female" (sex assigned at birth).',
      };
    },
  },
  {
    key: "anemia",
    prompt:
      "Has a doctor or health worker ever told you that you have anemia — that is, a low red blood cell count?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("anemia"),
  },
  {
    key: "hypertension",
    prompt:
      "Do you have high blood pressure (hypertension), or do you take medicine to keep your blood pressure down?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("high blood pressure"),
  },
  {
    key: "diabetes",
    prompt: "Have you been diagnosed with diabetes (high blood sugar)?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("diabetes"),
  },
  {
    key: "cvd_history",
    prompt: "Have you ever had a heart attack or a stroke?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("a heart attack or stroke"),
  },
  {
    key: "chf_history",
    prompt:
      "Has a doctor ever told you that you have heart failure (also called congestive heart failure)?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("heart failure"),
  },
  {
    key: "pvd",
    prompt:
      "Has a doctor ever told you that you have poor blood circulation in your legs (peripheral vascular disease)?",
    inputType: "choice",
    options: ["Yes", "No"],
    parse: makeYesNoParser("poor blood circulation in the legs"),
  },
  {
    key: "proteinuria",
    // "Not sure" is a valid answer here: laypersons often haven't had a
    // urine test. Per the SCORED instrument this variable only scores when
    // known to be present, so "not sure" scores 0 (same as "no").
    prompt:
      "Has a urine test ever shown that you have protein in your urine? If you've never been told this, answer \"not sure\".",
    inputType: "choice",
    options: ["Yes", "No", "Not sure"],
    parse: (raw) => {
      const v = normalizeRaw(raw);
      // Unlike the other yes/no questions, "not sure" is a first-class
      // answer here, so unsure phrasings score 0 directly instead of
      // triggering the explain-or-answer-no guidance.
      if (isUnsure(raw)) return { ok: true, normalized: "not_sure", value: false };
      if (YES.has(v)) return { ok: true, normalized: "yes", value: true };
      if (NO.has(v)) return { ok: true, normalized: "no", value: false };
      return {
        ok: false,
        message: 'Please answer "yes", "no", or "not sure".',
      };
    },
  },
];

export function getQuestion(key: string): QuestionSpec {
  const q = QUESTIONS.find((q) => q.key === key);
  if (!q) throw new Error(`Unknown SCORED variable key: ${key}`);
  return q;
}
