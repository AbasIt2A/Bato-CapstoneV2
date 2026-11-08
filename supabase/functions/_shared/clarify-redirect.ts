// Symptom / self-assessment redirect for the LLM Clarification Engine.
//
// ===== WHY THIS EXISTS =====
//
// The SCORED questionnaire (Bang et al., 2007, Figure 2) asks whether a
// person HAS a condition — "I had/have anemia" — and instructs: "If a
// statement is not true or you are not sure, put a zero." The valid answer is
// a person's recall of a diagnosis they already know about.
//
// Explaining what a term MEANS supports that recall: someone told they were
// "kulang sa dugo" learns that this is anemia. Listing SYMPTOMS, giving a
// threshold to compare one's own reading against, or telling someone how to
// work out whether they have a condition does something else: it lets an
// unsure user infer a status they do not know, turning "not sure → 0" into a
// self-diagnosed "yes → 1". That is outside what the instrument was designed
// to capture, and it pushes scores toward Screen Positive.
//
// So those questions never reach retrieval or generation. They get a fixed,
// server-written reply that says what the question is really asking, repeats
// the paper's not-sure rule, and points to the general KidneyLearn, where
// symptoms can be discussed with no score depending on them.
//
// Fixed text rather than a prompt instruction because a model cannot drift
// into listing symptoms if it never writes the reply, and fixed text can be
// tested. The system prompt carries the same rule as a second layer, for
// phrasings these patterns miss.
//
// Pure: no I/O, no env, safe for the offline test suite.

/** The seven SCORED variables that are medical conditions. */
export type ConditionKey =
  | "anemia"
  | "hypertension"
  | "diabetes"
  | "cvd_history"
  | "chf_history"
  | "pvd"
  | "proteinuria";

/** Why a question was redirected. Logged; never shown to the user. */
export type RedirectReason = "symptoms" | "reading" | "self_assessment";

export interface Redirect {
  reason: RedirectReason;
  /** Null when the question names no screening condition (e.g. CKD). */
  condition: ConditionKey | null;
  reply: string;
}

interface ConditionWording {
  /** Completes "This question is about whether ...". Mirrors questions.ts. */
  asks: string;
  /** Plain name used in "ask about <name> symptoms". */
  name: string;
  /** What the screening asks an unsure person to answer. */
  unsure: string;
  /** An example symptom, only where one is common and harmless to name. */
  symptomExample?: string;
}

const ANSWER_NO = "the screening asks you to answer no";

const CONDITIONS: Record<ConditionKey, ConditionWording> = {
  anemia: {
    asks: "a doctor or health worker has told you that you have anemia",
    name: "anemia",
    unsure: ANSWER_NO,
    symptomExample: "tiredness",
  },
  hypertension: {
    asks:
      "a doctor or health worker has told you that you have high blood " +
      "pressure, or whether you take medicine to keep it down",
    name: "high blood pressure",
    unsure: ANSWER_NO,
  },
  diabetes: {
    asks: "a doctor or health worker has diagnosed you with diabetes",
    name: "diabetes",
    unsure: ANSWER_NO,
  },
  cvd_history: {
    asks:
      "a doctor or health worker has told you that you had a heart attack " +
      "or a stroke",
    name: "heart attack and stroke",
    unsure: ANSWER_NO,
  },
  chf_history: {
    asks: "a doctor or health worker has told you that you have heart failure",
    name: "heart failure",
    unsure: ANSWER_NO,
  },
  pvd: {
    asks:
      "a doctor or health worker has told you that you have poor blood " +
      "circulation in your legs (peripheral vascular disease)",
    name: "peripheral vascular disease",
    unsure: ANSWER_NO,
  },
  proteinuria: {
    asks: "a urine test has ever shown protein in your urine",
    name: "protein in the urine",
    // "Not sure" is a first-class answer on this question (questions.ts).
    unsure: 'the screening asks you to answer "not sure"',
  },
};

// Condition terms, checked in this order. Heart failure before heart attack
// so "heart failure" never resolves to cvd_history.
const CONDITION_TERMS: [ConditionKey, RegExp][] = [
  ["chf_history", /\b(?:heart\s+failure|congestive)\b/i],
  ["cvd_history", /\b(?:heart\s+attack|stroke|cardiovascular)\b/i],
  ["pvd", /\b(?:peripheral|circulation|vascular)\b/i],
  ["proteinuria", /\b(?:proteinuria|protein|albumin|foamy)\b/i],
  ["anemia", /\b(?:anemi\w*|anaemi\w*|red\s+blood\s+cells?|hemoglobin|haemoglobin|kulang\s+sa\s+dugo)\b/i],
  ["diabetes", /\b(?:diabet\w*|blood\s+sugar|sugar\s+level|asukal)\b/i],
  ["hypertension", /\b(?:hypertens\w*|blood\s+pressure|bp|altapresyon)\b/i],
];

const KIDNEY_TERMS = /\b(?:kidneys?|renal|ckd|bato)\b/i;

/**
 * A question asking for a number to compare a reading against, or quoting
 * the user's own reading.
 */
const READING_SHAPE = new RegExp(
  [
    String.raw`\bcounts?\s+as\s+(?:high|low|normal|a\s+high)\b`,
    String.raw`\bhow\s+high\b`,
    String.raw`\b(?:normal|healthy|high|low)\s+(?:range|level|reading|number|value)s?\b`,
    String.raw`\bwhat\s+(?:is\s+)?(?:a\s+)?(?:normal|healthy|high)\s+(?:blood\s+pressure|blood\s+sugar|bp|hemoglobin)\b`,
    String.raw`\b\d{2,3}\s*\/\s*\d{2,3}\b`,
    String.raw`\b(?:my|a)\s+(?:blood\s+pressure|bp|blood\s+sugar|sugar|reading|result|level|hemoglobin)\b[^.?!]*\d`,
  ].join("|"),
  "i",
);

/**
 * "Is anemia a sign of kidney disease?" — asking whether a condition is a
 * sign OF the kidneys is a legitimate why-does-this-matter question, not a
 * request for symptoms. Checked before every pattern below.
 */
//
// The article is what separates it from a symptom request: "is anemia A sign
// of kidney disease?" asks about anemia, "what are THE symptoms of CKD?"
// asks for a list.
const SIGN_OF_KIDNEY =
  /\b(?:is|are|can|could)\b[^.?!]*\ban?\s+(?:early\s+)?(?:sign|symptom)\s+of\s+(?:\w+\s+)?(?:kidneys?|renal|ckd)\b/i;

/** A question about symptoms or signs. */
const SYMPTOM_SHAPE = new RegExp(
  [
    // "sympt\w*" also catches the common misspelling "symptions".
    String.raw`\bsympt\w*`,
    String.raw`\bsintomas\b`,
    String.raw`\bsenyales\b`,
    String.raw`\bpalatandaan\b`,
    String.raw`\btimailhan\b`,
    String.raw`\bwarning\s+signs?\b`,
    String.raw`\bsigns?\s+(?:of|that|and|i|you)\b`,
    String.raw`\bi\s+(?:feel|felt|am\s+feeling|get|have\s+been)\s+(?:tired|weak|dizzy|pale|short\s+of\s+breath)\b`,
  ].join("|"),
  "i",
);

/** A question asking whether the user has a condition, or how to tell. */
const SELF_ASSESSMENT_SHAPE = new RegExp(
  [
    // "(?!\s+to)" keeps "do I have to answer yes?" out.
    String.raw`\b(?:do|could|might|may)\s+i\s+(?:possibly\s+)?have\b(?!\s+to\b)`,
    String.raw`\bam\s+i\s+(?:anemic|anaemic|diabetic|hypertensive|at\s+risk)\b`,
    String.raw`\bhow\s+(?:do|would|can|could|will|did|does)\s+(?:i|you|someone|a\s+person|people|one)\s+(?:know|tell|find\s+out|check)\b`,
    String.raw`\bmeron\s+(?:ba\s+)?(?:ako|akong)\b`,
    String.raw`\bnaa\s+(?:ba\s+)?(?:ko|koy)\b`,
  ].join("|"),
  "i",
);

function isConditionKey(key: unknown): key is ConditionKey {
  return typeof key === "string" && Object.hasOwn(CONDITIONS, key);
}

/** The screening condition the question is about, if one can be told. */
function resolveCondition(
  question: string,
  variableKey: unknown,
): ConditionKey | null {
  for (const [key, pattern] of CONDITION_TERMS) {
    if (pattern.test(question)) return key;
  }
  // Names the kidneys and no screening condition: a CKD question, not one
  // about the variable on screen.
  if (KIDNEY_TERMS.test(question)) return null;
  return isConditionKey(variableKey) ? variableKey : null;
}

function reasonFor(question: string): RedirectReason | null {
  if (SIGN_OF_KIDNEY.test(question)) return null;
  if (READING_SHAPE.test(question)) return "reading";
  if (SYMPTOM_SHAPE.test(question)) return "symptoms";
  if (SELF_ASSESSMENT_SHAPE.test(question)) return "self_assessment";
  return null;
}

const CHAT = "KidneyLearn after you finish";

function conditionReply(reason: RedirectReason, c: ConditionWording): string {
  const opening = `This question is about whether ${c.asks}`;
  const close = `If you're not sure, ${c.unsure}.`;
  switch (reason) {
    case "symptoms":
      return `${opening}, not about symptoms. ${
        c.symptomExample
          ? `Symptoms like ${c.symptomExample} have`
          : "Symptoms can have"
      } many causes, so they can't tell you whether you have it. ${close} ` +
        `You can ask about ${c.name} symptoms in ${CHAT}.`;
    case "reading":
      return `${opening}, not about a particular reading or test number. ` +
        `One number can't tell you whether you have it; only a doctor or ` +
        `health worker can. ${close} You can ask what the numbers mean in ` +
        `${CHAT}.`;
    case "self_assessment":
      return `${opening}. I can't tell whether you have it, and the ` +
        `screening doesn't ask you to work it out. ${close} You can ask ` +
        `more about ${c.name} in ${CHAT}.`;
  }
}

function generalReply(reason: RedirectReason): string {
  const opening =
    "This screening asks about conditions a doctor or health worker has " +
    "already told you about";
  const close = "If you're not sure about a question, the screening asks you to answer no.";
  switch (reason) {
    case "symptoms":
      return `${opening}, not about symptoms. Symptoms have many causes, so ` +
        `they can't tell you whether you have a condition. ${close} You can ` +
        `ask about symptoms in ${CHAT}.`;
    case "reading":
      return `${opening}, not about a particular reading or test number. ` +
        `One number can't tell you whether you have a condition; only a ` +
        `doctor or health worker can. ${close} You can ask what the numbers ` +
        `mean in ${CHAT}.`;
    case "self_assessment":
      return `${opening}. I can't tell whether you have a condition, and ` +
        `the screening doesn't ask you to work it out. ${close} You can ask ` +
        `more about kidney health in ${CHAT}.`;
  }
}

/**
 * The redirect for `question`, or null when it should go through the normal
 * clarification pipeline (definitions, "why does this matter", age and sex).
 *
 * `variableKey` is the client-supplied current step. It only ever selects
 * among the fixed wordings above.
 */
export function detectRedirect(
  question: string,
  variableKey: unknown,
): Redirect | null {
  const reason = reasonFor(question);
  if (!reason) return null;
  const condition = resolveCondition(question, variableKey);
  return {
    reason,
    condition,
    reply: condition
      ? conditionReply(reason, CONDITIONS[condition])
      : generalReply(reason),
  };
}
