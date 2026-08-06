// Evaluation instruments: SUS, TAM, TiMT item banks and composite scoring.
//
// ⚠️ CONFIRM: the TAM and TiMT item wordings below are standard adaptations
// drafted for BATO. Before the evaluation study, align them verbatim with
// the instruments approved in your manuscript. SUS is the standard 10-item
// scale (Brooke, 1996) with "system" phrased as "BATO".

export interface LikertOption {
  value: number;
  label: string;
}

export const LIKERT_5: LikertOption[] = [
  { value: 1, label: "Strongly disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Neutral" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly agree" },
];

export interface InstrumentSpec {
  title: string;
  description: string;
  items: string[];
  computeScore: (values: number[]) => number;
}

export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  SUS: {
    title: "System Usability Scale (SUS)",
    description:
      "Rate how much you agree with each statement about using BATO.",
    items: [
      "I think that I would like to use BATO frequently.",
      "I found BATO unnecessarily complex.",
      "I thought BATO was easy to use.",
      "I think that I would need the support of a technical person to be able to use BATO.",
      "I found the various functions in BATO were well integrated.",
      "I thought there was too much inconsistency in BATO.",
      "I would imagine that most people would learn to use BATO very quickly.",
      "I found BATO very cumbersome to use.",
      "I felt very confident using BATO.",
      "I needed to learn a lot of things before I could get going with BATO.",
    ],
    // Standard SUS scoring → 0–100 (odd items: value-1; even items: 5-value; ×2.5).
    computeScore(values) {
      const sum = values.reduce(
        (acc, v, i) => acc + (i % 2 === 0 ? v - 1 : 5 - v),
        0,
      );
      return Math.round(sum * 2.5 * 100) / 100;
    },
  },
  TAM: {
    title: "Technology Acceptance Model (TAM)",
    description:
      "Rate how much you agree with each statement about BATO's usefulness and ease of use.",
    items: [
      // Perceived usefulness (Davis, 1989 — adapted)
      "Using BATO helps me understand my risk of chronic kidney disease.",
      "Using BATO makes it easier to decide whether I should get tested.",
      "BATO gives me useful information about kidney health.",
      "Overall, I find BATO useful for checking my CKD risk.",
      // Perceived ease of use
      "Learning to use BATO was easy for me.",
      "The screening questions were clear and easy to answer.",
      "Interacting with BATO's chat assistants was clear and understandable.",
      "Overall, I find BATO easy to use.",
    ],
    // Mean of item scores (1–5).
    computeScore(values) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.round(mean * 100) / 100;
    },
  },
  TiMT: {
    title: "Trust in Medical Technology (TiMT)",
    description:
      "Rate how much you agree with each statement about trusting BATO.",
    items: [
      "I trust the screening result BATO gave me.",
      "I believe the information BATO provides comes from credible medical sources.",
      "BATO was honest about what it can and cannot do (screening, not diagnosis).",
      "I would follow BATO's recommendation to consult a health professional.",
      "I felt my answers were handled safely and privately.",
      "I would recommend BATO to family or friends who want to check their kidney health risk.",
    ],
    // Mean of item scores (1–5).
    computeScore(values) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.round(mean * 100) / 100;
    },
  },
};
