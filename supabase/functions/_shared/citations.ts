// Attribution handling for the General CKD Chatbot's replies.
//
// ===== WHY THIS EXISTS =====
//
// Grounding is enforced by making the model attribute what it says. Until
// now that attribution WAS the reply text: the prompt required "According to
// NIDDK, ..." or "(Source: CDC)" in the prose, and the output guard treated
// an answer naming none of the retrieved sources as ungrounded.
//
// That reads badly. Nearly every answer opened with "According to X" and
// carried "(Source: Y)" mid-sentence, which is not how a plain-language
// health assistant should sound — and the frontend already shows the sources
// as chips underneath, so the prose was saying twice what the UI said once.
//
// The obvious alternative — drop the citation requirement and check
// groundedness by comparing the reply's wording to the retrieved passages —
// was measured on 2026-08-11 and REJECTED. Content-word overlap does not
// separate the two populations on this corpus: genuine grounded replies
// scored 0.654-0.750 while a fabricated general-knowledge answer about BMI
// scored 0.667. There is no threshold inside that band, for the same reason
// the answer cache cannot match on similarity alone (see answer-cache.ts):
// topical vocabulary dominates, and being about kidneys is not evidence of
// coming from the corpus.
//
// So attribution stays mandatory and stays verified — it just stops being
// prose. The model ends its reply with one machine-readable line:
//
//     SOURCES: NIDDK, APSN
//
// The server verifies those IDs against what was actually retrieved, strips
// the line, and hands the IDs to the frontend as the source chips. The user
// sees clean prose; the guard sees the same declaration it always did.
//
// stripInlineCitations() is the backstop for the same goal: models comply
// with "do not name sources in the prose" imperfectly, and a stray
// "(Source: NIDDK)" would put back exactly what this change removes.
//
// Pure module: no network, no env, no Deno APIs. Used by the general-chat
// Edge Function only — the Clarification Engine keeps prose citations,
// because the assessment UI has no chip row to move them to.

import { APPROVED_SOURCE_IDS, SOURCE_DISPLAY_NAMES } from "./sources.ts";
import type { RerankedChunk } from "./rerank.ts";

/** The exact line the model is asked to end its reply with. */
export const SOURCE_FOOTER_LABEL = "SOURCES:";

/**
 * Matches an approved ID as a standalone token.
 *
 * Case-sensitive, and apostrophes count as part of the token: the IDs are
 * short uppercase abbreviations, so a case-insensitive match would turn the
 * pronoun "who" into a WHO citation, and a plain \b boundary would find "ISN"
 * inside "isn't".
 */
function idPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9'])${escaped}([^A-Za-z0-9']|$)`);
}

const ID_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
  APPROVED_SOURCE_IDS.map((id) => [id, idPattern(id)]),
);

/** True iff `text` names `id` as a standalone token. */
export function mentionsSourceId(text: string, id: string): boolean {
  return ID_PATTERNS.get(id)?.test(text) ?? false;
}

/**
 * Every source ID a reply grounded in `chunks` is entitled to declare.
 *
 * Two kinds, and the second is the point. A chunk carries a `source` — its
 * file's provenance of record, e.g. NIDDK. But a passage may itself credit
 * another approved body inline, the way the body-weight section credits
 * "(APSN, 2025)" for the progression claim. A reply that uses that sentence
 * is grounded in APSN, and saying so is more accurate than filing it under
 * NIDDK, so inline credits inside the retrieved text are admissible too.
 *
 * Only IDs already on the approved list can appear either way, so this can
 * never widen attribution beyond the register.
 */
export function allowedCitationIds(chunks: RerankedChunk[]): string[] {
  const allowed = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.source) allowed.add(chunk.source);
    for (const id of APPROVED_SOURCE_IDS) {
      if (mentionsSourceId(chunk.content, id)) allowed.add(id);
    }
  }
  return [...allowed];
}

export interface SplitReply {
  /** The reply as the user should see it — footer removed, trimmed. */
  visible: string;
  /** IDs declared on the footer line, in order, deduped. Never validated here. */
  declared: string[];
  /** False when no footer line was found at all. */
  hasFooter: boolean;
}

/**
 * Splits a draft into its visible prose and the source IDs declared on its
 * final SOURCES line.
 *
 * Tolerant about the shapes models actually emit — "SOURCES: NIDDK, CDC",
 * "Sources: NIDDK; CDC", a leading dash, bold markers — because a reply that
 * attributes correctly but punctuates the line unusually should not be
 * treated as ungrounded. It is NOT tolerant about position: only the last
 * non-empty line is considered, so a mid-answer mention can never be mistaken
 * for the declaration.
 */
export function splitSourceFooter(draft: string): SplitReply {
  const lines = draft.replace(/\r\n/g, "\n").split("\n");
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return { visible: "", declared: [], hasFooter: false };

  const candidate = lines[lastIdx].trim().replace(/^[-*\s]+/, "").replace(
    /\*/g,
    "",
  );
  const match = /^sources?\s*:\s*(.*)$/i.exec(candidate);
  if (!match) {
    return { visible: draft.trim(), declared: [], hasFooter: false };
  }

  const declared = [
    ...new Set(
      match[1]
        .split(/[,;/]| and /i)
        .map((part) => part.trim().replace(/[.)\]]+$/, ""))
        .filter((part) => part.length > 0),
    ),
  ];
  const visible = lines.slice(0, lastIdx).join("\n").trim();
  return { visible, declared, hasFooter: true };
}

// ---------------------------------------------------------------------------
// Inline-citation stripping
// ---------------------------------------------------------------------------

/** "(Source: NIDDK)", "(Sources: NIDDK, CDC)", "[Source: WHO]". */
const SOURCE_PARENTHETICAL = /[([]\s*sources?\s*:[^)\]]*[)\]]/gi;

/**
 * A parenthetical made up ONLY of approved source IDs, years, "et al." and
 * separators — "(NIDDK)", "(APSN, 2025)", "(NIDDK, CDC)". Anything else
 * inside the brackets means it is not a citation and is left alone.
 */
const BARE_CITATION_PARENTHETICAL = /\(([^()]{1,80})\)/g;

const CITATION_INNER =
  /^(?:\s*(?:[A-Z][A-Za-z0-9]{1,9}|\d{4}|et\s+al\.?|,|;|&|and|\s)\s*)+$/;

/** "According to NIDDK, " / "As NIDDK explains, " openers. */
function stripAttributionOpener(text: string): string {
  const opener =
    /^\s*(?:according\s+to|as\s+(?:stated|explained|described|noted|reported)\s+by|as|per)\s+(?:the\s+)?([^,.]{2,90}?)\s*(?:,\s*|\s+(?:explains?|states?|notes?|says?|reports?)\s*,?\s*)/i;
  const match = opener.exec(text);
  if (!match) return text;

  // Only strip when the thing being cited is actually a registered source —
  // "As kidneys fail, ..." and "According to your doctor, ..." must survive.
  const subject = match[1].trim();
  const subjectLower = subject.toLowerCase();
  const isSource = APPROVED_SOURCE_IDS.some((id) => {
    if (mentionsSourceId(subject, id)) return true;
    const name = (SOURCE_DISPLAY_NAMES[id] ?? "")
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, " ")
      .trim();
    if (!name) return false;
    if (subjectLower.includes(name)) return true;
    // And the other direction: prose drops qualifiers the register keeps —
    // "the Centers for Disease Control and Prevention" for a source
    // registered as "US Centers for Disease Control and Prevention". The
    // length floor stops a short common word ("health") from matching its way
    // into "Department of Health".
    return subjectLower.length >= 10 && name.includes(subjectLower);
  });
  if (!isSource) return text;

  const rest = text.slice(match[0].length);
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * Removes source attribution from prose: parenthetical citations and a
 * leading "According to X," opener. Whitespace and stray punctuation left by
 * a removal are tidied so the sentence still reads normally.
 *
 * A backstop, not the mechanism — the prompt asks for prose without
 * citations, and this catches the times the model does it anyway.
 */
export function stripInlineCitations(text: string): string {
  let out = text.replace(SOURCE_PARENTHETICAL, "");
  out = out.replace(BARE_CITATION_PARENTHETICAL, (whole, inner: string) => {
    if (!CITATION_INNER.test(inner)) return whole;
    // Require at least one real source ID, so "(2020)" or "(and)" survives.
    return APPROVED_SOURCE_IDS.some((id) => mentionsSourceId(inner, id))
      ? ""
      : whole;
  });
  out = stripAttributionOpener(out);
  // Tidy: space before punctuation, doubled spaces, orphaned ", ." sequences.
  out = out
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
