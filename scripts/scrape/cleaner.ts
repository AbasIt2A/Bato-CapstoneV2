// BATO — cleaner for scraped source material.
//
// Turns the markdown Firecrawl returns into something that can survive
// scripts/chunker.ts and be worth embedding. Two very different messes arrive
// here and the pipeline branches on which one it is:
//
//   WEB   — navigation, cookie notices, "Share this page", social links,
//           breadcrumb trails, image embeds, and link-only list items. The
//           text is well-formed; the noise is around it.
//
//   PDF   — the text itself is damaged. Words are hyphen-split across line
//           breaks ("kid-\nney"), paragraphs are hard-wrapped at whatever
//           column the typesetter used, ligatures arrive as single glyphs
//           (ﬁ), a running header repeats on all 140 pages, and page numbers
//           sit on their own lines throughout.
//
// Why this matters more than it looks: every one of those artefacts becomes
// part of an embedding vector. "kid-\nney" does not embed as "kidney". A
// running header repeated 140 times dominates the chunk it lands in. Cleaning
// is not cosmetic here — it is the difference between a retrievable corpus
// and a noisy one.
//
// PURE module, on the same terms as chunker.ts: no network, no file I/O, no
// Deno.env, no import-time side effects. It takes a string and returns
// strings plus a report. scripts/clean-scraped.ts is the only caller that
// touches disk.
//
// ===== WHAT THIS DELIBERATELY DOES NOT DO =====
//
// It never sets `approved: true`. Approval is an adviser's editorial
// judgement about clinical content, and no regex is entitled to make it. Every
// document this produces carries `approved: false`, so chunkMarkdownDocument()
// hard-rejects it until a human has read it and flipped the flag by hand.
// The cleaner's job ends at "readable and correctly labelled"; the corpus
// gate is somebody else's.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentKind = "web" | "pdf" | "local";

export interface CleanOptions {
  kind: DocumentKind;
  /** Human title, used for front-matter and as the H1 fallback. */
  title: string;
  /** Approved source ID, or null when the publisher is unregistered. */
  sourceId: string | null;
  scopes: string[];
  topicTags: string[];
  /** Provenance URL, recorded in front-matter. */
  url?: string;
  /** ISO date (YYYY-MM-DD) recorded as last_updated. */
  retrievedOn: string;
}

export interface RuleEffect {
  rule: string;
  charsRemoved: number;
  /** Sample of what the rule removed, for auditing a surprising number. */
  samples: string[];
}

export interface CleanReport {
  rawChars: number;
  cleanChars: number;
  /** Fraction of the raw document that survived, 0-1. */
  retainedRatio: number;
  effects: RuleEffect[];
  warnings: string[];
  headings: { h1: number; h2: number; h3: number };
}

export interface CleanResult {
  /** Cleaned body WITH generated YAML front-matter — ready to write to disk. */
  markdown: string;
  /** Cleaned body without front-matter. */
  body: string;
  report: CleanReport;
}

/** Placeholder written as `source:` when the publisher is not on the approved
 *  register. Chosen to be obviously wrong and guaranteed to fail
 *  isApprovedSource(), so the document cannot be ingested by accident. */
export const UNREGISTERED_SOURCE = "UNREGISTERED";

// ---------------------------------------------------------------------------
// Rule plumbing
// ---------------------------------------------------------------------------

/** Collects per-rule diffs so the CLI can print what actually fired rather
 *  than asserting that cleaning happened. */
class Recorder {
  readonly effects: RuleEffect[] = [];

  apply(
    rule: string,
    text: string,
    fn: (t: string, note: (s: string) => void) => string,
  ): string {
    const samples: string[] = [];
    const before = text.length;
    const after = fn(text, (s) => {
      const trimmed = s.trim();
      if (trimmed && samples.length < 6 && !samples.includes(trimmed)) {
        samples.push(trimmed.slice(0, 100));
      }
    });
    const removed = before - after.length;
    if (removed !== 0 || samples.length > 0) {
      this.effects.push({ rule, charsRemoved: removed, samples });
    }
    return after;
  }
}

/** Drops every line for which `predicate` is true. */
function dropLines(
  text: string,
  note: (s: string) => void,
  predicate: (line: string) => boolean,
): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (predicate(line)) {
      note(line);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 1 — character-level normalisation (both kinds)
// ---------------------------------------------------------------------------

// Deliberately NOT Unicode NFKC. NFKC would rewrite "1.73 m²" to "1.73 m2"
// and "µg" to "μg", and the first of those is a unit that appears in the eGFR
// definition this whole corpus is built around. Targeted replacements only.
const CHAR_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  // Ligatures — extremely common in PDF text extraction.
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/ﬅ/g, "st"],
  // Quotes and apostrophes.
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  // Dashes. En dash between digits is a range ("2-3"); elsewhere a hyphen.
  [/(\d)\s*–\s*(\d)/g, "$1-$2"],
  [/—/g, "—"], // em dash kept: the corpus already uses it in prose
  [/–/g, "-"],
  [/−/g, "-"], // minus sign
  // Bullets that survived as literal glyphs rather than markdown list markers.
  [/^[ \t]*[•●▪◦·⁃∙][ \t]+/gm, "- "],
  // Invisible and exotic whitespace.
  [/­/g, ""], // soft hyphen — pure noise, never renders
  [/[​‌‍﻿]/g, ""], // zero-width family
  [/[          ]/g, " "],
  // Ellipsis.
  [/…/g, "..."],
];

function normaliseCharacters(text: string, note: (s: string) => void): string {
  let out = text.replace(/\r\n?/g, "\n");
  for (const [pattern, replacement] of CHAR_REPLACEMENTS) {
    if (pattern.test(out)) {
      pattern.lastIndex = 0;
      const sample = out.match(pattern)?.[0];
      if (sample) note(`${JSON.stringify(sample)} -> ${JSON.stringify(replacement)}`);
      out = out.replace(pattern, replacement);
    }
    pattern.lastIndex = 0;
  }
  return out;
}

/**
 * Undoes Firecrawl's markdown escaping.
 *
 * Firecrawl backslash-escapes markdown metacharacters and terminates wrapped
 * lines with a trailing `\` (markdown's hard-line-break syntax). In the KDIGO
 * guideline that is 1768 of 1778 lines in a single chapter, and it is not
 * cosmetic in two separate ways:
 *
 *   - the trailing slash ends up INSIDE the text once lines are rejoined
 *     ("validated tools in\ clinical practice to assess"), so the corruption
 *     lands in the middle of a sentence that will be embedded;
 *   - it defeats other rules. A heading line "Chapter 5. Optimal models of
 *     care\" is not equal to its running-header twin without the slash, so
 *     duplicate detection misses it, and the inferred heading text carries a
 *     stray backslash into heading_path.
 *
 * Runs before everything structural for that second reason.
 */
function unescapeMarkdown(text: string, note: (s: string) => void): string {
  let trailing = 0;
  let inline = 0;
  const out = text
    // Trailing hard-break slashes, including "\ " with trailing space.
    .replace(/\\+[ \t]*$/gm, () => {
      trailing++;
      return "";
    })
    // Escaped metacharacters anywhere else.
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>~%&$@"'/])/g, (_m, ch: string) => {
      inline++;
      return ch;
    });
  if (trailing > 0) note(`${trailing} trailing hard-break backslash(es)`);
  if (inline > 0) note(`${inline} escaped metacharacter(s) unescaped`);
  return out;
}

/**
 * Converts the LaTeX that Firecrawl's PDF parser emits back into plain text.
 *
 * Typeset math in a PDF comes back as markup, not characters, and in the
 * KDIGO guideline that lands squarely on the two strings this corpus can
 * least afford to lose:
 *
 *   "1.73 m²"  ->  "1. 7 3 \mathrm {m} ^ {2}"
 *   "CKD"      ->  "\mathrm {C K D}"
 *
 * The first is the denominator of the eGFR unit — the definitional quantity
 * the entire knowledge base is organised around — and the second is the
 * subject of the corpus, letter-spaced into something no embedding will ever
 * match against a user's question. 199 occurrences in one document.
 *
 * `\mathrm{A B C}` is joined back to "ABC" only when its contents are single
 * characters separated by spaces, which is exactly the letter-spacing
 * artefact; genuine multi-character content is passed through unchanged.
 */
function normaliseLatexMath(text: string, note: (s: string) => void): string {
  let hits = 0;
  let out = text
    // \mathrm{...} / \text{...} / \mathbf{...} — keep the contents.
    // One or two backslashes: Firecrawl escapes the command's own backslash
    // in some documents ("\\mathrm") and not in others, and this rule runs
    // before unescaping so it must accept both.
    .replace(
      /\\{1,2}(?:mathrm|mathbf|mathit|text|textrm|operatorname)\s*\{([^{}]*)\}/g,
      (_m, inner: string) => {
        hits++;
        const parts = inner.trim().split(/\s+/);
        // "C K D" -> "CKD"; anything longer is left spaced.
        return parts.every((p) => p.length === 1) ? parts.join("") : inner.trim();
      },
    )
    // Superscripts: "^ {2}" -> "²" so "m ^ {2}" reads as m². Only 2 and 3 have
    // unambiguous single characters; others fall back to a caret form.
    .replace(/\s*\^\s*\{\s*([^{}]*)\s*\}/g, (_m, sup: string) => {
      hits++;
      if (sup === "2") return "²";
      if (sup === "3") return "³";
      return `^${sup}`;
    })
    .replace(/\s*_\s*\{\s*([^{}]*)\s*\}/g, (_m, sub: string) => {
      hits++;
      return sub;
    })
    // NOTE ON `(?![a-zA-Z])` RATHER THAN `\b`.
    //
    // A LaTeX command ends at the first non-letter, which is NOT the same as
    // a word boundary. In "\geq30" the position after "geq" sits between two
    // word characters, so `\b` does not match and the command survives — and
    // "\geq30", "\leq0.001", "\pm4.5" are exactly how these appear in the
    // KDOQI nutrition guideline, i.e. the common case rather than the edge
    // case. Every macro pattern here therefore tests "not followed by a
    // letter" instead.
    .replace(/\\{1,2}(?:left|right|quad|qquad)(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "";
    })
    // LaTeX's punctuation-named spacing commands (\, \; \: \!) and its
    // control space ("\ "). These need their OWN rule rather than joining the
    // alternation above, because the `(?![a-zA-Z])` guard is wrong for them:
    // "\,P<0.001" is a thin space followed by a letter, so the guard rejected
    // the very form that actually occurs. They are spaces, so they become one.
    .replace(/\\{1,2}[,;:!]/g, () => {
      hits++;
      return " ";
    })
    .replace(/\\{1,2}(?=[ \t])/g, () => {
      hits++;
      return "";
    })
    // The handful of symbol macros that actually appear in clinical text.
    .replace(/\\{1,2}mu(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "µ";
    })
    .replace(/\\{1,2}times(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "×";
    })
    .replace(/\\{1,2}(?:leq|le)(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "≤";
    })
    .replace(/\\{1,2}(?:geq|ge)(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "≥";
    })
    .replace(/\\{1,2}pm(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "±";
    })
    .replace(/\s*\\{1,2}circ(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "°";
    })
    // Greek letters carry meaning in statistical notation ("α ≤0.10"), so map
    // them rather than let the catch-all below delete them.
    .replace(
      /\\{1,2}(alpha|beta|gamma|delta|sigma|chi|kappa|lambda|omega)(?![a-zA-Z])\s*/gi,
      (_m, name: string) => {
        hits++;
        return GREEK[name.toLowerCase()] ?? "";
      },
    )
    // CATCH-ALL for the long tail. After the specific rules above have taken
    // their better-quality conversions, ~30 further macros remain across the
    // corpus (\mathtt, \mathbb, \dot, \bar, \overline, \textcircled…), each
    // only a handful of times — not worth a rule apiece, and all of them pure
    // noise once the typesetting is gone. A backslash command never appears
    // in legitimate clinical prose, so removing the command while keeping its
    // braced argument is safe and collapses the whole tail at once.
    .replace(/\\{1,2}[a-zA-Z]+\s*\{([^{}]*)\}/g, (_m, inner: string) => {
      hits++;
      return inner;
    })
    .replace(/\\{1,2}[a-zA-Z]+(?![a-zA-Z])\s*/g, () => {
      hits++;
      return "";
    })
    // A backslash directly before a digit or brace is the same artefact
    // without a command name ("P \1 2", "(P \3 0 > 8 0 %)").
    .replace(/\\{1,2}(?=[\d{}])/g, () => {
      hits++;
      return "";
    });

  // Leftover braces from nested constructs the brace rules could not unwrap
  // ("{{k g k}m²}"). Only when this document actually contained LaTeX —
  // braces are legitimate text elsewhere, and this guard keeps the rule from
  // touching a document that never had any markup to begin with.
  if (hits > 0) {
    out = out.replace(/[{}]/g, () => {
      hits++;
      return "";
    });
  }

  if (hits > 0) note(`${hits} LaTeX math construct(s) converted to text`);
  return out;
}

/** Greek letters that survive into clinical/statistical text. */
const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  sigma: "σ",
  chi: "χ",
  kappa: "κ",
  lambda: "λ",
  omega: "ω",
};

/**
 * Repairs decimals the PDF typeset with spaces between their digits.
 *
 * The same letter-spacing that turned "CKD" into "C K D" turns "1.73" into
 * "1. 7 3", and it lands on the eGFR denominator 89 times in the KDIGO
 * guideline alone: "1. 7 3 m²" where the corpus needs "1.73 m²".
 *
 * ANCHORED TO A FOLLOWING UNIT, and that anchor is the entire safety
 * argument. A general "close up spaces between digits" rule would happily
 * rewrite the genuine data row "9.1 9.0 9.6 13 14" into one meaningless
 * number. Requiring a unit token immediately after means the only things
 * repaired are quantities, where the spacing is unambiguously an artefact.
 */
const SPACED_DECIMAL_BEFORE_UNIT =
  /(\d)\.[ \t]+(\d)(?:[ \t]+(\d))?(?=[ \t]*(?:m²|m2\b|mg\b|mL\b|ml\b|kg\b|mmol\b|mmHg\b|%))/g;

function repairSpacedDecimals(text: string, note: (s: string) => void): string {
  let hits = 0;
  const out = text.replace(
    SPACED_DECIMAL_BEFORE_UNIT,
    (_m, a: string, b: string, c: string | undefined) => {
      hits++;
      return `${a}.${b}${c ?? ""}`;
    },
  );
  if (hits > 0) note(`${hits} space-separated decimal(s) closed up`);
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2 — markup stripping (both kinds)
// ---------------------------------------------------------------------------

function stripHtmlRemnants(text: string, note: (s: string) => void): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, (m) => {
      note(m);
      return "";
    })
    // Leftover inline tags Firecrawl occasionally passes through. <br> becomes
    // a newline; everything else is dropped, keeping the inner text.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:span|div|p|em|strong|b|i|u|sup|sub|a|img|figure|figcaption|section|article|header|footer|nav|small)\b[^>]*>/gi, (m) => {
      note(m);
      return "";
    });
}

function stripImages(text: string, note: (s: string) => void): string {
  // Markdown images carry no retrievable text and their alt text is usually
  // a filename or "Image".
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => {
    note(m);
    return "";
  });
}

/**
 * Unwraps markdown links to their anchor text and removes bare URLs.
 *
 * A URL inside a stored chunk is a liability specific to this project: the
 * generation prompt is built to cite by approved source ID, and a raw link
 * sitting in the retrieved context is something the model can copy into an
 * answer as though it were a citation. Strip them at ingestion time rather
 * than trusting the output guard to catch every one.
 */
function stripLinks(text: string, note: (s: string) => void): string {
  const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

  // A line made of nothing but links and separators is navigation — a
  // breadcrumb trail, a menu row, a "related pages" strip. Detecting it
  // BEFORE unwrapping is what makes this precise: afterwards "Home | Kidney
  // Disease" is indistinguishable from prose, but right now it is provably
  // three links and a pipe. A sentence that merely contains a link keeps its
  // text, because stripping the link leaves real words behind.
  let out = dropLines(text, note, (line) => {
    if (!LINK.test(line)) {
      LINK.lastIndex = 0;
      return false;
    }
    LINK.lastIndex = 0;
    const residue = line
      .replace(LINK, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[|•·>»/\\\-–—:,]/g, "")
      .trim();
    return residue.length === 0;
  });

  out = out.replace(LINK, (match, label: string) => {
    note(match);
    return label.trim();
  });
  out = out.replace(/<?\bhttps?:\/\/[^\s<>)\]]+>?/g, (m) => {
    note(m);
    return "";
  });
  // Reference-style link definitions left behind at the foot of the document.
  out = dropLines(out, note, (line) => /^\s*\[[^\]]+\]:\s*\S+/.test(line));
  return out;
}

/**
 * Drops "Learn more at ." style stubs left behind once a URL is removed.
 *
 * The sentence existed only to carry the link; without it there is nothing to
 * learn more at. Matching is narrow on purpose — it requires BOTH a
 * call-to-action opener AND a trailing dangling connective, so "See your
 * doctor about testing." and "Visit the clinic every year." are untouched.
 */
const CTA_OPENER = String.raw`(?:learn|read|find\s+out)\s+more|for\s+more\s+information|more\s+information`;

/** The CTA occupies the whole line: "Learn more at". */
const DANGLING_CTA_LINE = new RegExp(
  String.raw`^\s*(?:${CTA_OPENER})\b[^.!?]{0,60}?\s*(?:at|on|from|here|via|visit|see|call)?\s*[.:]?\s*$`,
  "i",
);

/**
 * The CTA trails real content on the same line: "…every year. Learn more at".
 * Anchored to end-of-line, and only ever matches when the destination is
 * already gone — which is why this rule must run after link stripping. The
 * bounded `{0,60}` and the ban on sentence punctuation inside the match stop
 * it reaching backwards into the preceding sentence.
 */
const DANGLING_CTA_TAIL = new RegExp(
  String.raw`\s*\b(?:${CTA_OPENER})\b[^.!?]{0,60}?\s*\b(?:at|on|from|here|via|visit|see|call)\s*[.:]?\s*$`,
  "i",
);

function stripDanglingCallsToAction(
  text: string,
  note: (s: string) => void,
): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() && DANGLING_CTA_LINE.test(line)) {
      note(line);
      continue;
    }
    const trimmed = line.replace(DANGLING_CTA_TAIL, "");
    if (trimmed !== line && trimmed.trim().length > 0) {
      note(line.slice(trimmed.length));
      kept.push(trimmed);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Tidies punctuation stranded by removals: " ." after a citation marker,
 * " ," after an unwrapped link, empty "()" after an image.
 *
 * The negative lookahead is not optional. Without it this rule rewrites
 * "Official websites use .gov" to "use.gov" and "connected to the .gov
 * website" to "the.gov" — silently corrupting text rather than tidying it,
 * which is worse than the stray space it was added to fix. A genuinely
 * stranded mark is followed by whitespace or end-of-line; a mark that opens a
 * word (".gov", ".org") belongs to that word and must keep its space.
 */
function tidyStrandedPunctuation(text: string, note: (s: string) => void): string {
  let fixed = 0;
  const out = text
    // Empty brackets FIRST. Order matters and got this wrong once: a URL
    // inside parentheses ("…under the CC BY-NC-ND license (http://…).")
    // strips to "license ().", and reattaching punctuation before removing
    // the empty parens leaves "license ." — the exact artefact this rule
    // exists to prevent.
    .replace(/\(\s*\)|\[\s*\]/g, (m) => {
      note(m);
      fixed++;
      return "";
    })
    .replace(/\(\s+/g, "(")
    .replace(/[ \t]+([.,;:!?)])(?![\w])/g, (_m, punct: string) => {
      fixed++;
      return punct;
    });
  if (fixed > 0) note(`${fixed} stranded punctuation mark(s) tidied`);
  return out;
}

/** Horizontal rules become blank lines. Kept simple: they carry no meaning
 *  once headings survive, and a stray `---` near the top of a file is an
 *  invitation to a front-matter parsing bug downstream. */
function stripHorizontalRules(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(line));
}

// ---------------------------------------------------------------------------
// Stage 3 — PDF-specific repair
// ---------------------------------------------------------------------------

/**
 * Rejoins words split by an end-of-line hyphen.
 *
 * Only joins when the continuation begins lowercase. "kid-\nney" is a split
 * word; "COVID-\n19" and "self-\nCare" are more likely a genuine compound
 * that happened to wrap, and joining those loses the hyphen that belongs
 * there. Erring toward leaving a hyphen alone is the cheaper mistake.
 */
function dehyphenate(text: string, note: (s: string) => void): string {
  return text.replace(/([A-Za-z])-\n[ \t]*([a-z])/g, (match, a: string, b: string) => {
    note(match.replace(/\n/g, "\\n"));
    return `${a}${b}`;
  });
}

const PAGE_FURNITURE: readonly RegExp[] = [
  /^\s*\d{1,4}\s*$/, // a bare page number on its own line
  /^\s*[-–—]\s*\d{1,4}\s*[-–—]\s*$/, // "- 12 -"
  /^\s*page\s+\d+\s*(of\s+\d+)?\s*$/i,
  /^\s*\d+\s*\|\s*page\s*$/i,
  /^\s*downloaded\s+(for|from)\b.*/i,
  /^\s*for\s+personal\s+use\s+only\b.*/i,
  /^\s*(copyright|©)\s*\d{4}\b.*/i,
  /^\s*all\s+rights\s+reserved\.?\s*$/i,
  /^\s*this\s+document\s+is\s+protected\s+by\s+copyright\b.*/i,
];

function stripPageFurniture(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) =>
    PAGE_FURNITURE.some((re) => re.test(line)));
}

/**
 * Removes running headers and footers by finding short lines that repeat
 * implausibly often.
 *
 * A guideline PDF prints its own title at the top of every page; after
 * extraction that title is simply a line appearing 140 times. No content line
 * behaves that way. The threshold is deliberately conservative (3+ repeats,
 * short, non-structural) and every removed line is reported, because the one
 * way this rule can go wrong — eating a genuinely repeated short sentence —
 * is only visible to a human reading the report.
 */
function stripRepeatedLines(
  text: string,
  note: (s: string) => void,
  minRepeats = 3,
  maxLen = 120,
): string {
  const lines = text.split("\n");
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    if (!key || key.length > maxLen) continue;
    // Structural lines repeat legitimately (list markers, table rows) and
    // headings are the document's skeleton — never candidates.
    if (/^([#>|]|[-*+]\s|\d+\.\s)/.test(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const furniture = new Set(
    [...counts.entries()]
      .filter(([, n]) => n >= minRepeats)
      .map(([line]) => line),
  );
  if (furniture.size === 0) return text;
  return dropLines(text, note, (line) => furniture.has(line.trim()));
}

/**
 * Numbered bibliography entries that carry no "References" heading.
 *
 * stripTrailingApparatus() cuts a reference SECTION; this catches the case
 * where there is no section to cut. The KDIGO guideline is exactly that: no
 * "References" line survives extraction anywhere in 1.0 MB, yet a thousand
 * numbered citations sit in the text, and they were 100% of the reason the
 * document still cleaned to 96% of its original size.
 *
 * The discriminator is the author-initials signature — "Levey AS," or
 * "Ferguson T, Ravani P," or "Tangri N, … et al" — which numbered PROSE never
 * has. Verified against the real guideline: this matches 1002 lines, every
 * sampled one a citation, while genuine numbered content ("1. To ensure that
 * the evidence base is directly applicable…", "3. Estimating equations
 * equally applicable to…") does not match and survives.
 */
const NUMBERED_CITATION_LINE =
  /^\s*\d{1,4}[.)]\s+[A-Z][a-zA-Z'’-]+(\s+[A-Z][a-zA-Z'’-]+)?\s+[A-Z]{1,3}\b\s*(,|;|\.|\set\s+al)/;

function stripNumberedCitations(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) => NUMBERED_CITATION_LINE.test(line));
}

/** Bracketed reference markers: [12], [12,13], [12-15], [12–15]. Superscript
 *  markers are left alone — they are indistinguishable from real numbers once
 *  the formatting is gone, and removing digits from a clinical corpus on a
 *  guess is not a trade worth making. */
function stripCitationMarkers(text: string, note: (s: string) => void): string {
  return text.replace(/\[\s*\d+(\s*[,\-–]\s*\d+)*\s*\]/g, (m) => {
    note(m);
    return "";
  });
}

/**
 * Table-of-contents entries with dot leaders: "Introduction .......... 5".
 *
 * Unambiguous once the dots survive extraction, and a guideline PDF opens
 * with pages of them. Each is a heading duplicate pointing at a page number
 * that no longer exists, so every one is a near-duplicate embedding of a real
 * section heading — actively harmful to retrieval, not merely useless.
 */
const TOC_LEADER_LINE = /^\s*\S.*?[.·•‧]{3,}\s*\d{1,4}\s*$/;

function stripTocLeaders(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) => TOC_LEADER_LINE.test(line));
}

/**
 * Cuts the scholarly apparatus off the end of a document.
 *
 * A guideline or journal PDF ends in references, and for something like the
 * KDIGO guideline that can be a third of the file: hundreds of citation lines
 * that are pure noise to a retrieval corpus. Worse than noise, actually —
 * they are dense with author names and journal titles that embed as
 * plausible-looking text and can surface as a "passage" in response to a
 * question about a condition mentioned in a paper title.
 *
 * Two guards keep this from eating content:
 *   - the marker must be a STANDALONE line (a heading or bare label), not a
 *     sentence mentioning references;
 *   - it must fall in the last 40% of the document, so a "References" note in
 *     an early methods section cannot truncate the whole file.
 *
 * The cut is reported in characters, and the CLI prints it, because this is
 * the single most destructive rule in the pipeline and a human should see how
 * much it took.
 */
const APPARATUS_MARKER =
  /^\s*#{0,6}\s*\**\s*(references?|bibliography|literature\s+cited|reference\s+list|acknowledge?ments?|conflicts?\s+of\s+interest(\s+statement)?|author\s+contributions?|supplementary\s+(material|data|information)|disclosures?)\s*\**\s*:?\s*$/i;

/**
 * Minimum fraction of the document (by CHARACTERS) that must survive the cut.
 *
 * Replaces an earlier "marker must sit past 60% of the LINES" guard, which
 * measured the wrong thing. A journal article whose bibliography is longer
 * than its body puts "References" only a third of the way down by line count
 * even though it is unambiguously the trailing apparatus — so the line-based
 * guard refused to cut exactly the documents that needed it most. Retention
 * expresses the real intent directly: remove a trailing section, never
 * truncate the document.
 */
const APPARATUS_MIN_RETAINED = 0.5;

/**
 * Minimum size of the trailing region before it is worth cutting.
 *
 * This is what makes the rule safe to run on WEB documents too, which it must
 * be: the two largest chunks in the whole corpus were the reference lists of
 * the APSN (79,600 chars) and Chen (34,787 chars) journal articles, both
 * fetched as HTML. Gating on document FORMAT was the wrong axis — a PMC or
 * Wiley full text has exactly the same 30-page bibliography as the PDF does.
 * Gating on SIZE keeps the short "Related links"-style reference list at the
 * foot of a CDC page, which is real content, while removing the ones that are
 * genuinely apparatus.
 */
const APPARATUS_MIN_CHARS = 3000;

function stripTrailingApparatus(text: string, note: (s: string) => void): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!APPARATUS_MARKER.test(lines[i])) continue;
    const kept = lines.slice(0, i).join("\n");
    const cut = lines.slice(i).join("\n");
    // Too small to be the apparatus — probably a short, genuine source list.
    if (cut.length < APPARATUS_MIN_CHARS) continue;
    // Cutting here would remove most of the document, so this marker is a
    // heading inside the body rather than the start of the back matter.
    if (kept.length < text.length * APPARATUS_MIN_RETAINED) continue;
    note(
      `cut ${cut.length} chars of trailing apparatus from "${lines[i].trim()}"`,
    );
    return kept;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Heading inference for unstructured PDFs
// ---------------------------------------------------------------------------

/**
 * Some PDFs extract to markdown with NO headings at all.
 *
 * The KDIGO 2024 guideline is the case that forced this: 1.0 MB of text and
 * exactly zero `#` lines. chunker.ts splits on H2, so without headings that
 * entire guideline — the definitional spine of the corpus — becomes ONE
 * chunk, which is the same as not having ingested it. Meanwhile the structure
 * is plainly there in the text ("Chapter 2: Risk assessment…", "1.2
 * Evaluation of GFR", "CONVERSION FACTORS…"); the extractor simply dropped
 * the formatting that marked it.
 *
 * So: recover the structure the PDF actually has, rather than accept a wall.
 * Chapters become H2 and numbered subsections H3, which is exactly the shape
 * chunker.ts splits well — a long H2 with H3 children splits at the H3
 * boundaries.
 */
const CHAPTER_HEADING =
  /^(chapter|section|part|appendix|annex)\s+([0-9]{1,2}|[IVXLC]{1,6})\s*[.:]\s*(.+)$/i;

/** "1.2 Evaluation of GFR" — a numbered subsection. The title must begin with
 *  a capital, which is what separates a heading from the data lines that open
 *  the same way ("1.73 m2 and ACR <10 mg/g", "9.1 9.0 9.6 13 14",
 *  "836.3 (704.2-981.6)"). */
const NUMBERED_SECTION = /^(\d{1,2}(?:\.\d{1,2}){1,2})\s+([A-Z].*)$/;

/** A standalone all-caps line: "CONVERSION FACTORS OF CONVENTIONAL UNITS". */
const ALLCAPS_HEADING = /^[A-Z][A-Z0-9 &,.'’\/()-]{7,69}$/;

/** Longest a line may be and still plausibly be a heading. */
const MAX_HEADING_LENGTH = 120;

/**
 * True if `text` reads like a title rather than a data row: at least two
 * word-ish tokens, and mostly letters rather than digits and punctuation.
 */
function looksLikeTitle(text: string): boolean {
  const words = text.match(/[A-Za-z][A-Za-z'’-]+/g) ?? [];
  if (words.length < 2) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const solid = text.replace(/\s/g, "").length;
  return solid > 0 && letters / solid >= 0.6 && letters >= 10;
}

/**
 * One heading per this many characters is considered "structured enough".
 *
 * Measured against the real corpus: NICE NG203 has a heading every ~870
 * chars and KDOQI every ~2300, so both are left alone; KDIGO (none at all)
 * and the ISN Atlas (one per ~28,000) fall through to inference. The gate
 * matters — running inference over an already-structured document would
 * promote emphasised body text and fragment it.
 */
const HEADING_DENSITY_FLOOR = 5000;

function inferPdfHeadings(text: string, note: (s: string) => void): string {
  const existing = (text.match(/^#{1,6}[ \t]/gm) ?? []).length;
  if (existing >= text.length / HEADING_DENSITY_FLOOR) return text;

  let promoted = 0;
  const out = text.split("\n").map((line) => {
    if (/^#{1,6}[ \t]/.test(line)) return line; // already marked up
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return line;

    const chapter = CHAPTER_HEADING.exec(trimmed);
    if (chapter && looksLikeTitle(chapter[3])) {
      promoted++;
      note(`H2 <- ${trimmed}`);
      return `## ${trimmed}`;
    }

    const numbered = NUMBERED_SECTION.exec(trimmed);
    if (numbered && looksLikeTitle(numbered[2])) {
      promoted++;
      note(`H3 <- ${trimmed}`);
      return `### ${trimmed}`;
    }

    if (ALLCAPS_HEADING.test(trimmed) && looksLikeTitle(trimmed)) {
      promoted++;
      note(`H2 <- ${trimmed}`);
      return `## ${trimmed}`;
    }

    return line;
  });

  if (promoted > 0) note(`${promoted} heading(s) inferred from PDF text`);
  return out.join("\n");
}

const STRUCTURAL_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|\s*$)/;

/**
 * Rejoins paragraph lines that a PDF's fixed column width broke apart.
 *
 * Conservative by construction: it joins only when the previous line does not
 * end a sentence AND the next line starts lowercase, and never touches
 * headings, list items, table rows or fenced blocks. Under-joining leaves a
 * few ragged paragraphs, which embeds fine; over-joining welds a heading onto
 * a paragraph and corrupts the chunk boundaries the chunker depends on.
 */
function reflowWrappedLines(text: string, note: (s: string) => void): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let joins = 0;
  for (const line of lines) {
    const prev = out.length > 0 ? out[out.length - 1] : undefined;
    if (
      prev !== undefined &&
      prev.trim() &&
      line.trim() &&
      !STRUCTURAL_LINE.test(prev) &&
      !STRUCTURAL_LINE.test(line) &&
      // Previous line did not finish a sentence…
      !/[.!?:;]["')\]]?\s*$/.test(prev) &&
      // …and this one continues it.
      /^[a-z(,;]/.test(line.trim())
    ) {
      out[out.length - 1] = `${prev.replace(/\s+$/, "")} ${line.trim()}`;
      joins++;
      continue;
    }
    out.push(line);
  }
  if (joins > 0) note(`${joins} wrapped line(s) rejoined`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 4 — boilerplate (mostly web, harmless on PDFs)
// ---------------------------------------------------------------------------

// Whole-line matches only. Every entry is anchored so that a sentence merely
// containing the word (e.g. "share your results with your doctor") is never
// removed — the target is a nav element that occupies its own line.
const BOILERPLATE_LINES: readonly RegExp[] = [
  /^\s*skip\s+to\s+(main\s+)?content\s*$/i,
  /^\s*(back\s+to\s+)?top\s*$/i,
  /^\s*(share|print|email|download)(\s+this)?(\s+page)?\s*$/i,
  /^\s*(facebook|twitter|x|linkedin|instagram|youtube|pinterest|whatsapp|reddit)\s*$/i,
  /^\s*(follow\s+us|share\s+on\s+\w+|print\s+friendly)\s*$/i,
  /^\s*on\s+this\s+page\s*:?\s*$/i,
  /^\s*(in\s+this\s+section|table\s+of\s+contents|contents)\s*:?\s*$/i,
  /^\s*(related|see\s+also|further\s+reading|more\s+information|related\s+(topics|links|pages|content))\s*:?\s*$/i,
  /^\s*(previous|next)(\s+(page|article|section))?\s*$/i,
  /^\s*(home|menu|search|close|sign\s+in|log\s+in|register|subscribe)\s*$/i,
  /^\s*(español|other\s+languages?)\s*$/i,
  /^\s*(cookie|cookies)\b.*\b(policy|settings|consent|accept|preferences)\b.*$/i,
  /^\s*we\s+(use|would\s+like\s+to\s+use)\s+cookies\b.*$/i,
  /^\s*accept\s+(all\s+)?cookies\s*$/i,
  /^\s*(this\s+site|our\s+website)\s+uses\s+cookies\b.*$/i,
  /^\s*(privacy\s+policy|terms\s+of\s+(use|service)|accessibility|disclaimer|site\s*map|contact\s+us)\s*$/i,
  /^\s*(page\s+)?last\s+(reviewed|updated|modified|revised)\s*:?.*$/i,
  // The same claim as a full sentence ("The information on this page was last
  // reviewed by subject matter experts…"), which the anchored pattern above
  // misses. It sits inside a content section on CDC pages, so left alone it
  // is embedded as part of a real chunk rather than dropped as a footer.
  /^\s*the\s+(information|content)\s+on\s+this\s+page\s+was\s+last\s+(reviewed|updated)\b.*$/i,
  /^\s*content\s+source\s*:?.*$/i,
  /^\s*(reviewed|written|medically\s+reviewed)\s+by\s*:?.*$/i,
  // The US federal site banner, which prefaces every CDC and NIDDK page —
  // six of the twenty sources. Firecrawl renders it as four short bolded
  // lines, so all four are matched rather than just the opener.
  /^\s*an?\s+official\s+website\s+of\s+the\b.*$/i,
  /^\s*official\s+websites\s+use\b.*$/i,
  /^\s*secure\s*\.?gov\s+websites\s+use\b.*$/i,
  /^\s*an?\s*\.?gov\s+website\s+belongs\s+to\b.*$/i,
  /^\s*an?\s+(lock|padlock)\b.*\bmeans\s+you'?ve\s+safely\s+connected\b.*$/i,
  /^\s*share\s+sensitive\s+information\s+only\s+on\s+official\b.*$/i,
  /^\s*(https?:\/\/)?\s*means\s+you'?ve\s+safely\s+connected\b.*$/i,
  /^\s*(u\.?s\.?\s+)?department\s+of\s+health\s+(and|&)\s+human\s+services\s*$/i,
  /^\s*national\s+institutes\s+of\s+health\s*$/i,
  /^\s*centers\s+for\s+disease\s+control\s+and\s+prevention\s*$/i,
  /^\s*(advertisement|sponsored\s+content)\s*$/i,
  /^\s*\**\s*(figure|table|exhibit)\s+\d+[.:]?\s*$/i, // orphaned caption stub
];

/**
 * The subset of chrome that may also be removed when it arrives as a HEADING.
 *
 * Needed because a scraped page routinely renders the publisher's own name as
 * an H1 above the article's H1 ("# Centers for Disease Control and
 * Prevention"), and that is not cosmetic: normaliseHeadings() keeps the FIRST
 * H1, so left alone the site name becomes the document title and every
 * heading_path in the corpus reads "Centers for Disease Control and
 * Prevention > …" instead of naming the article.
 *
 * DELIBERATELY NARROWER than BOILERPLATE_LINES. The generic navigation words
 * in that list — "next", "home", "search", "top", "print" — are perfectly
 * plausible heading text, and an early version of this rule deleted a real
 * "## Next Section" heading by matching the pagination pattern against it.
 * Only organisational, legal and page-furniture phrasings appear here: none
 * of them is a section a CKD document would actually have.
 */
const CHROME_HEADING_LINES: readonly RegExp[] = [
  /^\s*an?\s+official\s+website\s+of\s+the\b.*$/i,
  /^\s*(u\.?s\.?\s+)?department\s+of\s+health\s+(and|&)\s+human\s+services\s*$/i,
  /^\s*national\s+institutes\s+of\s+health\s*$/i,
  /^\s*centers\s+for\s+disease\s+control\s+and\s+prevention\s*$/i,
  /^\s*(cookie|cookies)\b.*\b(policy|settings|consent|accept|preferences)\b.*$/i,
  /^\s*(privacy\s+policy|terms\s+of\s+(use|service)|accessibility|disclaimer|site\s*map)\s*$/i,
  /^\s*(page\s+)?last\s+(reviewed|updated|modified|revised)\s*:?.*$/i,
  /^\s*content\s+source\s*:?.*$/i,
  /^\s*on\s+this\s+page\s*:?\s*$/i,
  /^\s*(table\s+of\s+contents|in\s+this\s+section)\s*:?\s*$/i,
  /^\s*(related\s+(topics|links|pages|content)|see\s+also|further\s+reading)\s*:?\s*$/i,
  /^\s*(advertisement|sponsored\s+content)\s*$/i,
  /^\s*(follow\s+us|share\s+on\s+\w+)\s*$/i,
  /^\s*skip\s+to\s+(main\s+)?content\s*$/i,
];

/**
 * Removes markdown emphasis so boilerplate patterns can match the TEXT rather
 * than its formatting.
 *
 * Firecrawl renders the federal `.gov` banner as bolded lines
 * ("**Official websites use .gov**"), which anchored patterns miss entirely —
 * the line starts with an asterisk, not a word. Emphasis is stripped only for
 * the purposes of the test; the surviving line keeps its original formatting.
 */
function stripEmphasis(line: string): string {
  return line.replace(/[*_`~]+/g, "").replace(/\s{2,}/g, " ").trim();
}

function stripBoilerplate(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) => {
    const bare = stripEmphasis(line);
    if (BOILERPLATE_LINES.some((re) => re.test(line) || re.test(bare))) {
      return true;
    }
    const headingText = /^#{1,6}[ \t]+(.+?)[ \t]*$/.exec(line)?.[1];
    if (headingText === undefined) return false;
    const bareHeading = stripEmphasis(headingText);
    return CHROME_HEADING_LINES.some(
      (re) => re.test(headingText) || re.test(bareHeading),
    );
  });
}

/**
 * Ad-tech and page-shell debris from pages whose article never rendered.
 *
 * The Lancet GBD scrape is the case in point: it returned an advertising
 * console dump — "Open GPT Console", "Moat Init", a targeting table — and not
 * one word of the paper. Nothing here is recoverable content, and leaving it
 * in produces the worst possible outcome: a small, tidy-looking file that a
 * curator might mistake for a thin article rather than a failed fetch.
 */
const PAGE_SHELL_JUNK: readonly RegExp[] = [
  /^\s*open\s+(gpt|oracle)\s+console\s*$/i,
  /^\s*open\s+oracle\s+keywords\s*$/i,
  /^\s*refresh\s+values\s*$/i,
  /^\s*scroll\s+to\s+continue\s+with\s+content\s*$/i,
  /^\s*\|?\s*(ad\s*file|disable\s+ads\s+flag|moat\s+(init|ready)|contextual\s+(ready|url|initial\s+segments|used\s+segments)|ad\s*unit|sub\s*ad\s*unit|custom\s+targeting|ad\s+events)\s*\|.*$/i,
  /^\s*\|\s*(property|status|version|environment)\s*\|\s*\|?\s*$/i,
  // A table row whose cells are all empty — the residue of the same dump.
  /^\s*\|(\s*\|)+\s*$/,
  /^\s*skip\s+to\s+main\s+(content|menu)\b.*$/i,
];

function stripPageShellJunk(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) =>
    PAGE_SHELL_JUNK.some((re) => re.test(line)));
}

/** Consecutive duplicate non-empty lines — a common artefact of both PDF
 *  column extraction and HTML-to-markdown conversion of nav + heading pairs. */
function dropConsecutiveDuplicates(text: string, note: (s: string) => void): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out.length > 0 ? out[out.length - 1] : undefined;
    if (prev !== undefined && line.trim() && line.trim() === prev.trim()) {
      note(line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Very short orphan lines left after link and boilerplate stripping — a nav
 *  list reduced to one- and two-character stubs. Headings, list items and
 *  table rows are exempt; so is anything containing a digit, since a stray
 *  "90" could be a real value in a table remnant. */
function dropOrphanFragments(text: string, note: (s: string) => void): string {
  return dropLines(text, note, (line) => {
    const t = line.trim();
    if (!t || t.length > 3) return false;
    if (/^([#>|]|[-*+]$|\d)/.test(t)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Stage 5 — heading structure
// ---------------------------------------------------------------------------

/**
 * Forces the heading tree into the shape chunker.ts can actually read.
 *
 * chunkMarkdownDocument() needs exactly one H1 (it builds heading_path from
 * it and throws without one) and splits chunks at H2. Its heading regex only
 * recognises levels 1-3, so an H4 is not a heading to it at all — it silently
 * becomes body text in whatever chunk precedes it. Three fixes:
 *
 *   - no H1        → insert one from the document title
 *   - extra H1s    → demote to H2 (a scraped page often has the site name and
 *                    the article title both as H1)
 *   - H4/H5/H6     → flatten to H3
 */
function normaliseHeadings(
  text: string,
  note: (s: string) => void,
  title: string,
): string {
  let seenH1 = false;
  const lines = text.split("\n").map((line) => {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!match) return line;
    const level = match[1].length;
    const heading = match[2].trim();
    if (level === 1) {
      if (!seenH1) {
        seenH1 = true;
        return `# ${heading}`;
      }
      note(`H1 demoted to H2: ${heading}`);
      return `## ${heading}`;
    }
    if (level >= 4) {
      note(`H${level} flattened to H3: ${heading}`);
      return `### ${heading}`;
    }
    return `${match[1]} ${heading}`;
  });

  if (!seenH1) {
    note(`inserted missing H1: ${title}`);
    return `# ${title}\n\n${lines.join("\n")}`;
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Oversized-section splitting
// ---------------------------------------------------------------------------

/** A leaf section longer than this is split. Just under the chunker's own
 *  2500-char section threshold, so a split leaf lands comfortably inside it. */
const MAX_LEAF_CHARS = 2400;

/** Target size for each part when splitting. Leaves headroom for the ~200
 *  char intro overlap chunker.ts prepends to H3-derived chunks. */
const TARGET_PART_CHARS = 1800;

/**
 * Inserts H3 subheadings inside sections too large for the chunker to split.
 *
 * chunker.ts splits an H2 section at its H3 boundaries, but ONLY if it has
 * H3s — a long H2 with no subheadings stays one chunk however large it gets.
 * That is how KDIGO's "Chapter 5. Optimal models of care" became an 87,874
 * character chunk: 87 KB of real guidance embedded as a single vector, which
 * is an average of everything in it and retrieves for nothing in particular.
 *
 * The fix belongs HERE rather than in the chunker. chunker.ts is the approved
 * ingestion contract, its behaviour is pinned by tests, and the retrieval
 * thresholds in scopes.ts were tuned against the chunk sizes it produces;
 * changing how it splits would invalidate that tuning for the entire existing
 * corpus. Giving it well-formed headings to split on instead changes nothing
 * for any document that already had them.
 *
 * Splitting happens at PARAGRAPH boundaries only, never mid-paragraph and
 * never mid-table — a paragraph longer than the target is emitted whole
 * rather than cut, on the same principle chunker.ts follows for lists and
 * tables. Part headings are explicit ("… (part 2)") so a curator reading
 * heading_path can see the division is mechanical and not the publisher's.
 */
function splitOversizedSections(
  text: string,
  note: (s: string) => void,
): string {
  const lines = text.split("\n");
  const out: string[] = [];

  /** Heading the current leaf sits under, for naming its parts. */
  let leafTitle = "";
  /** True when the current leaf is an H2 with no H3 children yet. */
  let leafIsH2Body = false;
  /**
   * Whether any H2 has been seen yet.
   *
   * Content before the first H2 is the document's ROOT INTRO, and subdividing
   * it with H3s accomplishes nothing: chunker.ts only collects H3s that fall
   * inside an H2 section, so H3s above the first one are invisible to it and
   * the intro stays a single chunk. The WHO resolution (12,802 chars over 54
   * paragraphs) and the Philippine hypertension CPG (8,404 over 37) were both
   * exactly this. Parts of a root intro therefore become H2s, which is the
   * level the chunker actually splits on.
   */
  let seenH2 = false;
  let buffer: string[] = [];
  let splits = 0;

  const flush = () => {
    const body = buffer.join("\n");
    buffer = [];
    if (body.trim().length <= MAX_LEAF_CHARS) {
      if (body.length > 0) out.push(body);
      return;
    }

    // Group paragraphs into parts of roughly TARGET_PART_CHARS.
    const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    const parts: string[][] = [];
    let current: string[] = [];
    let currentLen = 0;
    for (const para of paragraphs) {
      if (currentLen > 0 && currentLen + para.length > TARGET_PART_CHARS) {
        parts.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(para);
      currentLen += para.length + 2;
    }
    if (current.length > 0) parts.push(current);

    if (parts.length <= 1) {
      // One indivisible paragraph (usually a wide table). Leave it whole —
      // cutting inside it would corrupt the structure it represents.
      out.push(body);
      return;
    }

    const base = leafTitle || "Section";
    // Root intro splits at H2 (the only level the chunker splits on up
    // there); everything else splits at H3, inside its parent H2.
    const marker = seenH2 ? "###" : "##";
    parts.forEach((part, i) => {
      // An H2 body — and a root intro — gets a heading on EVERY part,
      // including the first: leaving part 1 unheaded would make chunker.ts
      // treat it as the section's intro and prepend all of it to the first
      // chunk, recreating the oversized chunk this exists to fix. An H3 leaf
      // already carries its own heading, so its part 1 keeps it.
      if (i > 0 || leafIsH2Body || !seenH2) {
        out.push(`${marker} ${base} (part ${i + 1})`);
        out.push("");
      }
      out.push(part.join("\n\n"));
      out.push("");
    });
    splits++;
    note(`split "${base}" into ${parts.length} parts (${body.length} chars)`);
  };

  for (const line of lines) {
    const h2 = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    const h3 = /^###[ \t]+(.+?)[ \t]*$/.exec(line);
    const h1 = /^#[ \t]+(.+?)[ \t]*$/.exec(line);

    if (h2 || h3 || h1) {
      flush();
      out.push(line);
      if (h2) {
        leafTitle = h2[1];
        leafIsH2Body = true;
        seenH2 = true;
      } else if (h3) {
        leafTitle = h3[1];
        leafIsH2Body = false;
      } else {
        leafTitle = h1![1];
        leafIsH2Body = false;
      }
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (splits > 0) note(`${splits} oversized section(s) subdivided`);
  return out.join("\n");
}

function countHeadings(text: string): { h1: number; h2: number; h3: number } {
  const counts = { h1: 0, h2: 0, h3: 0 };
  for (const line of text.split("\n")) {
    const match = /^(#{1,3})[ \t]+\S/.exec(line);
    if (!match) continue;
    if (match[1].length === 1) counts.h1++;
    else if (match[1].length === 2) counts.h2++;
    else counts.h3++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Stage 6 — whitespace
// ---------------------------------------------------------------------------

function normaliseWhitespace(text: string, _note: (s: string) => void): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, "").replace(/[ \t]{2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Phrases that mean "you did not get the article". Worth naming explicitly
 *  so a 300-character consent screen is not mistaken for a thin page. */
const ACCESS_WALL_MARKERS: readonly RegExp[] = [
  /\bpurchase\s+(access|this\s+article|pdf)\b/i,
  /\bsubscribe\s+to\s+(view|read|access)\b/i,
  /\bget\s+access\s+to\s+the\s+full\s+(text|article)\b/i,
  /\bsign\s+in\s+to\s+(view|read|continue|access)\b/i,
  /\bjavascript\s+is\s+(disabled|required)\b/i,
  /\bverify\s+you\s+are\s+(a\s+)?human\b/i,
  /\benable\s+cookies\s+to\s+continue\b/i,
  /\baccess\s+denied\b/i,
  /\b403\s+forbidden\b/i,
];

function buildWarnings(
  body: string,
  headings: { h1: number; h2: number; h3: number },
  retainedRatio: number,
  opts: CleanOptions,
): string[] {
  const warnings: string[] = [];

  if (opts.sourceId === null) {
    warnings.push(
      `Publisher is NOT on the approved source register, so front-matter ` +
        `carries source: ${UNREGISTERED_SOURCE} and this file WILL be ` +
        `hard-rejected by the chunker. Register the source in ` +
        `knowledge_sources and _shared/sources.ts before curating it.`,
    );
  }

  if (body.length < 400) {
    warnings.push(
      `Cleaned body is only ${body.length} characters — likely a paywall, a ` +
        `consent screen, or a page whose content loads via JavaScript.`,
    );
  }

  // Prose density. A real document is mostly sentences; a page shell, a
  // navigation dump or an ad-console spill is mostly fragments and table
  // pipes. This generalises past the specific junk markers above, which only
  // ever catch the debris that has already been seen once.
  const proseLines = body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("|")) return false;
      const words = t.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
      return words.length >= 6 && /[.!?]["')\]]?$/.test(t);
    }).length;

  if (body.length >= 400 && proseLines < 3) {
    warnings.push(
      `Only ${proseLines} sentence-like line(s) in ${body.length} characters ` +
        `— this looks like a page shell or navigation dump rather than the ` +
        `source document. Verify before curating; the fetch probably failed ` +
        `even though it returned text.`,
    );
  }

  for (const marker of ACCESS_WALL_MARKERS) {
    const hit = marker.exec(body);
    if (hit) {
      warnings.push(
        `Access-wall text detected (${JSON.stringify(hit[0])}) — this is ` +
          `probably an interstitial, not the source document.`,
      );
      break;
    }
  }

  if (retainedRatio < 0.25) {
    warnings.push(
      `Only ${Math.round(retainedRatio * 100)}% of the raw text survived ` +
        `cleaning. Check the rule effects below — a rule may be too greedy ` +
        `for this document's layout.`,
    );
  }

  if (headings.h2 === 0) {
    warnings.push(
      `No H2 headings. chunker.ts splits on H2, so this document would ` +
        `become ONE oversized chunk. Add section headings during curation.`,
    );
  }

  if (headings.h2 > 0 && body.length / headings.h2 > 6000) {
    warnings.push(
      `Averaging ${Math.round(body.length / headings.h2)} characters per H2 ` +
        `section — well past the chunker's 2500-character split threshold. ` +
        `Expect very large chunks unless H3 subsections are added.`,
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Front-matter generation
// ---------------------------------------------------------------------------

/** Quotes a scalar if it could confuse the chunker's tiny front-matter
 *  parser — a leading `[` reads as a list, and a leading quote as a quoted
 *  string it would then strip. */
function frontMatterScalar(value: string): string {
  const v = value.replace(/\r?\n/g, " ").trim();
  if (/^[\[{'"]/.test(v) || v.includes(": ")) {
    return JSON.stringify(v);
  }
  return v;
}

function frontMatterList(values: readonly string[]): string {
  return `[${values.join(", ")}]`;
}

export function buildFrontMatter(opts: CleanOptions): string {
  const lines = [
    "---",
    `source: ${opts.sourceId ?? UNREGISTERED_SOURCE}`,
    `title: ${frontMatterScalar(opts.title)}`,
    // NEVER true. See the module header — approval is an adviser's call and
    // the chunker's rejection of `false` is the mechanism that enforces it.
    "approved: false",
    `last_updated: ${opts.retrievedOn}`,
    `scopes: ${frontMatterList(opts.scopes)}`,
    `topic_tags: ${frontMatterList(opts.topicTags)}`,
  ];
  if (opts.url) {
    // Ignored by the chunker (extra keys are parsed and discarded) but kept
    // so provenance survives in the file a curator reads.
    lines.push(`source_url: ${opts.url}`);
  }
  lines.push(`retrieved_on: ${opts.retrievedOn}`);
  lines.push("---");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cleans one scraped document.
 *
 * Rule order is load-bearing in five places:
 *   - de-hyphenation runs BEFORE reflow, because it matches across the very
 *     newline that reflow removes;
 *   - repeated-line removal runs BEFORE reflow, because a running header
 *     welded onto a paragraph is no longer a repeated line;
 *   - the dangling-CTA rule runs AFTER link stripping — it recognises
 *     "Learn more at" precisely because the destination is already gone;
 *   - punctuation tidying runs after every rule that can strand a mark
 *     ("rate [12]." -> "rate .") and before reflow starts joining lines;
 *   - heading normalisation runs AFTER all line removal, so a demoted or
 *     inserted H1 cannot itself be deleted as boilerplate.
 */
export function cleanDocument(raw: string, opts: CleanOptions): CleanResult {
  const rec = new Recorder();
  const rawChars = raw.length;
  let text = raw;

  text = rec.apply("normalise-characters", text, normaliseCharacters);
  // Before every structural rule: escaping hides duplicate lines from the
  // running-header detector and leaks backslashes into inferred headings.
  // Before unescaping, which would otherwise strip the backslashes that
  // identify a LaTeX command and leave "mathrm {m} ^ {2}" as bare words.
  text = rec.apply("normalise-latex-math", text, normaliseLatexMath);
  // After the LaTeX pass, which is what exposes "1. 7 3 m²" by turning
  // "\mathrm {m} ^ {2}" into the unit the anchor looks for.
  text = rec.apply("repair-spaced-decimals", text, repairSpacedDecimals);
  text = rec.apply("unescape-markdown", text, unescapeMarkdown);
  text = rec.apply("strip-html-remnants", text, stripHtmlRemnants);
  text = rec.apply("strip-images", text, stripImages);

  // Kind-agnostic: journal articles fetched as HTML carry the same enormous
  // reference lists their PDFs do, and the size guard inside the rule is what
  // keeps a short web reference list safe. Runs before citation-marker
  // stripping — no point rewriting text about to be discarded.
  text = rec.apply("strip-trailing-apparatus", text, stripTrailingApparatus);

  if (opts.kind === "pdf" || opts.kind === "local") {
    text = rec.apply("dehyphenate-line-breaks", text, dehyphenate);
    text = rec.apply("strip-page-furniture", text, stripPageFurniture);
    text = rec.apply("strip-running-headers", text, (t, note) =>
      stripRepeatedLines(t, note));
    text = rec.apply("strip-toc-leaders", text, stripTocLeaders);
    // Catches unheaded bibliographies the apparatus cut cannot see.
    text = rec.apply("strip-numbered-citations", text, stripNumberedCitations);
    text = rec.apply("strip-citation-markers", text, stripCitationMarkers);
  }

  text = rec.apply("strip-links", text, stripLinks);
  text = rec.apply("drop-dangling-ctas", text, stripDanglingCallsToAction);
  text = rec.apply("strip-horizontal-rules", text, stripHorizontalRules);
  text = rec.apply("strip-page-shell-junk", text, stripPageShellJunk);
  text = rec.apply("strip-boilerplate", text, stripBoilerplate);
  // After every removal that can strand a mark, and before reflow joins lines.
  text = rec.apply("tidy-stranded-punctuation", text, tidyStrandedPunctuation);

  if (opts.kind === "pdf" || opts.kind === "local") {
    // After every line-removal pass, so boilerplate cannot be promoted to a
    // heading, and before reflow, which would otherwise weld an unmarked
    // heading line onto the paragraph beneath it.
    text = rec.apply("infer-pdf-headings", text, inferPdfHeadings);
    text = rec.apply("reflow-wrapped-lines", text, reflowWrappedLines);
  }

  // Second URL sweep. A PDF can wrap a URL across a line break ("http://" at
  // the end of one line, the host on the next); strip-links runs before
  // reflow, so it only ever saw the "http://" half. Now that reflow has
  // rejoined them, catch what that left — including the scheme-plus-space
  // form the first pass necessarily produced.
  text = rec.apply("strip-rejoined-urls", text, (t, note) =>
    t.replace(/<?\bhttps?:\/\/\s?[^\s<>)\]]*/g, (m) => {
      note(m);
      return "";
    }));
  text = rec.apply("drop-consecutive-duplicates", text, dropConsecutiveDuplicates);
  text = rec.apply("drop-orphan-fragments", text, dropOrphanFragments);
  text = rec.apply("normalise-headings", text, (t, note) =>
    normaliseHeadings(t, note, opts.title));
  // After heading normalisation, so it sees the final heading levels — and
  // after every removal pass, so it is not subdividing text about to be cut.
  text = rec.apply("split-oversized-sections", text, splitOversizedSections);
  text = rec.apply("normalise-whitespace", text, normaliseWhitespace);

  const body = text;
  const headings = countHeadings(body);
  const retainedRatio = rawChars > 0 ? body.length / rawChars : 0;

  const report: CleanReport = {
    rawChars,
    cleanChars: body.length,
    retainedRatio,
    effects: rec.effects,
    warnings: buildWarnings(body, headings, retainedRatio, opts),
    headings,
  };

  return {
    markdown: `${buildFrontMatter(opts)}\n\n${body}`,
    body,
    report,
  };
}
