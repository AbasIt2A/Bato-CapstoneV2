// Emergency check — runs BEFORE the gate in both chatbots.
//
// "I have severe chest pain, but I think it's just my kidney disease. What
// should I do?" was deflected as off-topic (2026-11-07): the gate saw chest
// pain, not kidneys. Someone describing a possible emergency must never get a
// refusal, a retrieval miss, or a filtered reply, so this is decided here,
// deterministically, with a fixed reply and no model call.
//
// It fires only on a FIRST-PERSON description ("I have…", "my chest…",
// "I can't breathe") so that a general question — "is chest pain a symptom
// of CKD?" — still goes through the normal pipeline.
//
// Pure: no I/O, safe for the offline test suite.

/** Symptom phrases that warrant emergency care (English, Tagalog, Bisaya). */
const SYMPTOM = new RegExp(
  [
    String.raw`\bchest\s+(?:pain|pains|tightness|pressure|hurts?|is\s+hurting)\b`,
    String.raw`\bpain\s+in\s+(?:my|the)\s+chest\b`,
    String.raw`\b(?:can'?t|cannot|can\s+not|unable\s+to|hard\s+to|trouble|difficulty|struggling\s+to)\s+(?:breathe|breathing|catch\s+my\s+breath)\b`,
    String.raw`\b(?:very\s+|really\s+|severely\s+)?short\s+of\s+breath\b`,
    String.raw`\b(?:can'?t|cannot|can\s+not|unable\s+to)\s+(?:pee|urinate|pass\s+urine)\b`,
    String.raw`\b(?:no|haven'?t\s+(?:passed\s+any|had\s+any))\s+urine\b`,
    String.raw`\bhaven'?t\s+(?:peed|urinated)\b`,
    String.raw`\b(?:fainted|passed\s+out|blacked\s+out|losing\s+consciousness|unconscious)\b`,
    String.raw`\bseizures?\b`,
    String.raw`\b(?:vomiting|throwing\s+up|coughing\s+up|coughing)\s+blood\b`,
    String.raw`\b(?:slurred|can'?t)\s+speech\b|\bface\s+(?:is\s+)?droop`,
    String.raw`\bsudden(?:ly)?\s+(?:numb|weak|can'?t\s+(?:move|see|speak))`,
    String.raw`\b(?:kill\s+myself|end\s+my\s+life|suicid\w*)\b`,
    // Tagalog / Bisaya.
    String.raw`\b(?:sakit|masakit)\s+(?:ang\s+|sa\s+)?dibdib\b`,
    String.raw`\b(?:hirap|nahihirapan)\s+(?:akong\s+|ako\s+)?huminga\b`,
    String.raw`\bhindi\s+(?:ako\s+)?maka-?ihi\b`,
    String.raw`\b(?:lisod|naglisod)\s+(?:ko\s+)?(?:og\s+)?ginhawa\b`,
    String.raw`\bdili\s+(?:ko\s+)?maka-?ihi\b`,
    String.raw`\bnahimatay\b`,
  ].join("|"),
  "i",
);

/** The message is about the person themselves. */
const FIRST_PERSON =
  /\b(?:i|i'm|im|i’m|i've|ive|me|my|mine|myself|ako|akong|ko|ang\s+aking|akoa)\b/i;

export const EMERGENCY_REPLY =
  "This could be a medical emergency. Please call 911 or go to the nearest " +
  "emergency room right away. Do not wait, and do not assume it is only " +
  "your kidney disease. If you can, ask someone to stay with you or to " +
  "bring you there.";

/** True when the message describes the user's own possible emergency. */
export function isEmergency(message: string): boolean {
  return SYMPTOM.test(message) && FIRST_PERSON.test(message);
}
