// BATO — Markdown chunker for the General CKD Chatbot's RAG knowledge base
// (hardened RAG spec §6, §11).
//
// PURE module: no network calls, no database access, and no Deno.env reads
// at import time (or anywhere in this file). It only parses a markdown
// string and returns structured chunks in memory. scripts/ingest-knowledge.ts
// is the only caller that touches the network/DB, and only after an
// explicit checkpoint approval.
//
// Contract (do not change the shape of these without updating every caller,
// including the test suite):
//   export interface MarkdownChunk { source, title, heading_path, content,
//     topic_tags, scopes }
//   export function chunkMarkdownDocument(markdown: string): MarkdownChunk[]
//
// Front-matter shape expected on every knowledge/*.md file (spec §6):
//   ---
//   source: NIDDK
//   title: CKD Basics
//   approved: true
//   last_updated: 2026-07-08
//   scopes: [general_education]          # REQUIRED, non-empty
//   topic_tags: [ckd, kidneys, basics]   # optional
//   ---
// Extra front-matter keys (e.g. `citations`) are parsed but ignored — they
// are not part of the MarkdownChunk contract.
//
// Splitting rules (spec §11.2, §4 non-goals — keep it simple, no custom
// semantic splitter):
//   - Split on H2 (`##`) headings; each H2 section is one chunk by default.
//   - H3 (`###`) subsections stay inside their parent H2 chunk UNLESS the H2
//     section's raw text exceeds ~2500 characters, in which case the section
//     is split at each H3 boundary. When split, every H3-derived chunk after
//     the first carries a small (~200 char) overlap taken from the tail of
//     the parent H2's intro paragraph(s), so a chunk read in isolation still
//     has some framing context. The first H3-derived chunk gets the full
//     intro (it already follows it directly, so no truncation is needed).
//   - Lists/tables are never split mid-structure: because splitting only
//     ever happens at heading boundaries, a section's raw markdown (bullets,
//     tables, etc.) is always copied through intact.
//   - heading_path is the breadcrumb "H1 > H2 [> H3]" built from the
//     document's actual markdown headings (not the front-matter title).

import {
  APPROVED_SOURCE_IDS,
  isApprovedSource,
} from "../supabase/functions/_shared/sources.ts";
import {
  isRetrievalScope,
  RETRIEVAL_SCOPES,
} from "../supabase/functions/_shared/scopes.ts";

export interface MarkdownChunk {
  source: string;
  title: string;
  heading_path: string;
  content: string;
  topic_tags: string[];
  /**
   * Retrieval scopes this document's chunks belong to. Required in
   * front-matter and never defaulted: which chatbot may surface a passage is
   * an editorial decision about the content, not something to infer.
   */
  scopes: string[];
}

/** Maximum raw-character length an H2 section may reach before it is split
 * at its H3 boundaries instead of staying one chunk. Approximate by design
 * (spec §11.2 "small overlap only where a section is long"). */
const MAX_SECTION_CHARS = 2500;

/** Target length of the intro-paragraph overlap carried into H3-derived
 * chunks after the first, when a long H2 section is split. */
const OVERLAP_CHARS = 200;

// ---------------------------------------------------------------------------
// Front-matter parsing (hand-rolled: the front-matter used here is always a
// flat block of `key: value` / `key: [a, b, c]` lines — no nesting, no
// multi-line scalars — so a tiny parser avoids pulling in a YAML dependency
// for a module that must stay import-time side-effect-free).
// ---------------------------------------------------------------------------

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((entry) => unquote(entry.trim()))
      .filter((entry) => entry.length > 0);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return unquote(value);
}

function parseFrontMatterBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    result[key] = parseYamlValue(line.slice(colonIdx + 1));
  }
  return result;
}

interface ParsedDocument {
  frontMatter: Record<string, unknown>;
  body: string;
}

function extractFrontMatter(markdown: string): ParsedDocument {
  const match = FRONT_MATTER_RE.exec(markdown);
  if (!match) {
    throw new Error(
      "chunkMarkdownDocument: document is missing the required YAML " +
        "front-matter block (must start with a --- ... --- block).",
    );
  }
  return {
    frontMatter: parseFrontMatterBlock(match[1]),
    body: markdown.slice(match[0].length),
  };
}

// ---------------------------------------------------------------------------
// Heading parsing
// ---------------------------------------------------------------------------

interface HeadingMatch {
  level: 1 | 2 | 3;
  text: string;
  /** Index of the first character of the heading line. */
  start: number;
  /** Index of the first character AFTER the heading line (and its newline). */
  contentStart: number;
}

const HEADING_RE = /^(#{1,3})[ \t]+(.+?)[ \t]*$/gm;

function findHeadings(body: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let match: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(body)) !== null) {
    headings.push({
      level: match[1].length as 1 | 2 | 3,
      text: match[2].trim(),
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  return headings;
}

/** Takes the tail of `text` up to ~`maxLen` characters, nudged forward to a
 * word boundary so the overlap doesn't start mid-word. */
function tailOverlap(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  let tail = trimmed.slice(-maxLen);
  const spaceIdx = tail.indexOf(" ");
  if (spaceIdx > -1 && spaceIdx < maxLen - 1) {
    tail = tail.slice(spaceIdx + 1);
  }
  return tail.trim();
}

function joinNonEmpty(parts: string[], sep = "\n\n"): string {
  return parts.filter((p) => p.trim().length > 0).join(sep);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkMarkdownDocument(markdown: string): MarkdownChunk[] {
  const { frontMatter, body } = extractFrontMatter(markdown);

  const source = frontMatter.source;
  const title = frontMatter.title;
  const approved = frontMatter.approved;
  const topicTagsRaw = frontMatter.topic_tags;

  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error(
      "chunkMarkdownDocument: front-matter \"source\" is required and must " +
        "be a non-empty string.",
    );
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error(
      "chunkMarkdownDocument: front-matter \"title\" is required and must " +
        "be a non-empty string.",
    );
  }
  if (approved !== true) {
    throw new Error(
      `chunkMarkdownDocument: document "${title}" (source: ${source}) is ` +
        "not approved for ingestion — front-matter \"approved\" must be " +
        `true (got ${JSON.stringify(approved)}).`,
    );
  }
  if (!isApprovedSource(source)) {
    throw new Error(
      `chunkMarkdownDocument: source "${source}" is not on the approved ` +
        `source list (${APPROVED_SOURCE_IDS.join(", ")}). Refusing to chunk ` +
        "unapproved content — route new sources through adviser review first.",
    );
  }

  const topicTags: string[] = Array.isArray(topicTagsRaw)
    ? topicTagsRaw.filter((tag): tag is string => typeof tag === "string")
    : [];

  // Scopes are mandatory. A missing value is not "general education by
  // default" — an untagged document silently reaching the mid-assessment
  // clarification path (or silently never reaching it) is precisely the
  // failure the scope separation exists to prevent, so refuse instead.
  const scopesRaw = frontMatter.scopes;
  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0) {
    throw new Error(
      `chunkMarkdownDocument: document "${title}" (source: ${source}) is ` +
        "missing front-matter \"scopes\" — it must be a non-empty list " +
        `drawn from [${RETRIEVAL_SCOPES.join(", ")}].`,
    );
  }
  const invalidScopes = scopesRaw.filter((s) => !isRetrievalScope(s));
  if (invalidScopes.length > 0) {
    throw new Error(
      `chunkMarkdownDocument: document "${title}" (source: ${source}) has ` +
        `unrecognised scope(s) ${JSON.stringify(invalidScopes)}. Valid ` +
        `scopes are [${RETRIEVAL_SCOPES.join(", ")}].`,
    );
  }
  const scopes = [...new Set(scopesRaw as string[])];

  const headings = findHeadings(body);
  const h1 = headings.find((h) => h.level === 1);
  if (!h1) {
    throw new Error(
      `chunkMarkdownDocument: document "${title}" (source: ${source}) has ` +
        "no top-level H1 heading; heading_path cannot be built.",
    );
  }
  const h1Text = h1.text;

  const h2s = headings.filter((h) => h.level === 2);

  const chunks: MarkdownChunk[] = [];
  const makeChunk = (headingPath: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      source,
      title,
      heading_path: headingPath,
      content: trimmed,
      topic_tags: [...topicTags],
      scopes: [...scopes],
    });
  };

  if (h2s.length === 0) {
    // No H2 headings at all: the whole document body is a single chunk
    // rooted at the H1 (robustness fallback; every current knowledge/*.md
    // file has at least one H2).
    makeChunk(h1Text, body.slice(h1.contentStart));
    return chunks;
  }

  // Any content between the H1 and the first H2 (a root intro paragraph) is
  // its own small chunk. None of the current knowledge/*.md files have this
  // (H1 is immediately followed by the first H2), so this is a no-op there.
  const rootIntro = body.slice(h1.contentStart, h2s[0].start);
  makeChunk(h1Text, rootIntro);

  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    const sectionEnd = i + 1 < h2s.length ? h2s[i + 1].start : body.length;
    const h2HeadingPath = `${h1Text} > ${h2.text}`;

    const h3sInSection = headings.filter(
      (h) => h.level === 3 && h.start > h2.start && h.start < sectionEnd,
    );

    const sectionRaw = body.slice(h2.contentStart, sectionEnd);

    if (h3sInSection.length === 0 || sectionRaw.trim().length <= MAX_SECTION_CHARS) {
      // Keep the whole H2 section (including any H3 sub-headings, rendered
      // inline as-is) as a single chunk.
      makeChunk(h2HeadingPath, sectionRaw);
      continue;
    }

    // Section is long AND has H3 subsections: split at each H3 boundary,
    // carrying a small overlap of the H2 intro into every split-off chunk
    // after the first.
    const intro = body.slice(h2.contentStart, h3sInSection[0].start).trim();
    const overlap = tailOverlap(intro, OVERLAP_CHARS);

    for (let j = 0; j < h3sInSection.length; j++) {
      const h3 = h3sInSection[j];
      const h3End = j + 1 < h3sInSection.length
        ? h3sInSection[j + 1].start
        : sectionEnd;
      const h3Body = body.slice(h3.contentStart, h3End).trim();
      const leadIn = j === 0 ? intro : overlap;
      const content = joinNonEmpty([leadIn, `### ${h3.text}\n\n${h3Body}`]);
      makeChunk(`${h2HeadingPath} > ${h3.text}`, content);
    }
  }

  return chunks;
}
