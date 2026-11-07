// Splits a chatbot reply into sentences and marks the ones that send the
// reader to a professional ("talk to your doctor", "seek emergency care"),
// so the UI can make them stand out. Done here rather than by the model so
// it works on every reply, cached ones included, with no change to the
// generation prompt or the reply format.
//
// Pure, no imports: the Deno test suite imports it directly.

export interface ReplyPart {
  text: string;
  advice: boolean;
}

/** Wording that refers the reader to a person or service for care. */
const ADVICE = new RegExp(
  [
    String.raw`\bdoctors?\b`,
    String.raw`\bphysicians?\b`,
    String.raw`\bpharmacists?\b`,
    String.raw`\bprescriber\b`,
    String.raw`\bnephrologists?\b`,
    String.raw`\bdietitians?\b`,
    String.raw`\b(?:health|healthcare|medical)\s+(?:care\s+)?(?:professionals?|providers?|workers?|team|centers?|centres?)\b`,
    String.raw`\bcare\s+team\b`,
    String.raw`\bhealth\s+care\s+team\b`,
    String.raw`\bemergency\b`,
    String.raw`\bseek\s+(?:immediate\s+)?(?:medical\s+)?(?:care|help|attention)\b`,
  ].join("|"),
  "i",
);

/**
 * Sentence boundaries: after . ! or ? (optionally followed by a closing
 * quote or bracket) and whitespace. Newlines are kept with the text so
 * paragraph breaks survive `white-space: pre-wrap`.
 */
const SENTENCE_END = /(?<=[.!?]["'”’)]?)(?=\s+)/;

export function splitAdvice(reply: string): ReplyPart[] {
  return reply
    .split(SENTENCE_END)
    .filter((s) => s.length > 0)
    .map((text) => ({ text, advice: ADVICE.test(text) }));
}
