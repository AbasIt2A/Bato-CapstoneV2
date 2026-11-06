// Server-side output guard (PRD §9 "guardrails"): a light, deterministic
// second layer that runs AFTER the LLM and BEFORE the reply is returned.
// It does not try to be smart — it catches the specific failure the PRD
// cares about most: diagnostic language ("you have CKD") reaching a user.

const DIAGNOSTIC_PATTERNS: RegExp[] = [
  // "you have/don't have (chronic) kidney disease / CKD / renal failure ..."
  //
  // The lookbehind exempts two things that are NOT diagnostic claims:
  //
  //   1. Reported speech — quoting the screening question back at the user
  //      ("asked if a doctor told you that you have anemia") is an
  //      explanation of the question, not a statement about the user.
  //
  //   2. The generic/conditional "you" — "when you have CKD, your kidneys
  //      don't filter blood well" describes the condition in general, the
  //      way health leaflets address a reader. Educational answers use this
  //      constantly, and without these conjunctions the filter blocks
  //      ordinary grounded content (verified: "When you have CKD…" and
  //      "Once you have kidney disease…" both tripped it).
  //
  //   3. Verbs of finding out — "how you would usually know you have
  //      diabetes", "you may find out you have it", "a doctor said you have
  //      anemia". The clarification prompt asks for exactly this ("how a
  //      person would usually know they have it"), and on 2026-11-06 a valid
  //      "What is diabetes?" reply was blocked on "know you have diabetes".
  //      First-person versions ("I know you have…") are caught by a separate
  //      pattern below.
  //
  // Deliberately NOT exempted: "because"/"since" ("because you have CKD…"),
  // which assert the diagnosis as established fact rather than supposing it;
  // nor "shows"/"means", which follow "your test" or "your result" as easily
  // as "a test" and would then state a diagnosis.
  /(?<!\b(?:told|tells?|telling|asked|asks|asking|if|whether|when|whenever|once|unless|while|know|knows|known|knew|learn|learns|learned|learnt|find\s+out|finds\s+out|found\s+out|say|says|said)\s+(?:you\s+)?(?:that\s+)?)\byou\s+(almost\s+certainly\s+|probably\s+|likely\s+|definitely\s+|clearly\s+)?(have|don'?t\s+have|do\s+not\s+have|are\s+suffering\s+from)\s+(?:a\s+)?(chronic\s+kidney\s+disease|ckd|kidney\s+disease|kidney\s+failure|kidney\s+stones?|renal\s+(disease|failure)|diabetes|hypertension|anemia|heart\s+failure)\b/i,
  /\b(i|we)\s+(can\s+)?diagnos\w+\s+you\b/i,
  // The assistant itself claiming to know — the one reading of the "know"
  // exemption above that is a diagnosis.
  /\b(i|we)\s+(can\s+)?(know|knew|think|believe|can\s+tell|see)\s+(that\s+)?you\s+(probably\s+|likely\s+)?(have|don'?t\s+have|do\s+not\s+have)\b/i,
  /\byour?\s+diagnosis\s+is\b/i,
  /\byou\s+(have|got)\s+(stage\s+\d)\b/i,
  /\b(\d{1,3})\s*%\s*(chance|probability|likelihood)\s+(that\s+)?you\b/i,
];

export interface FilterResult {
  ok: boolean;
  /** The reply to actually send (original, or a safe fallback if blocked). */
  reply: string;
  /** Present when blocked — log it, don't send it. */
  blockedReason?: string;
}

export const SAFE_FALLBACK_REPLY =
  "I can share general information about kidney health, but I can't make " +
  "statements about anyone's medical condition — BATO is a screening and " +
  "awareness tool, not a diagnostic one. For questions about your own " +
  "health, please talk to a doctor or your nearest health center.";

export function filterAssistantReply(reply: string): FilterResult {
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const match = reply.match(pattern);
    if (match) {
      return {
        ok: false,
        reply: SAFE_FALLBACK_REPLY,
        blockedReason: `diagnostic language: "${match[0]}"`,
      };
    }
  }
  return { ok: true, reply };
}
