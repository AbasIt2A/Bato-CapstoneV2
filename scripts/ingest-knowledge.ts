// BATO — one-time embedding + insertion script for the General CKD
// Chatbot's RAG knowledge base (hardened RAG spec §11).
//
// DO NOT RUN without explicit checkpoint approval. This script is drafted
// for review only; it must not be executed, and no migration/embedding/DB
// call may happen, until the human approves at the Phase 2 checkpoint.
//
// What it does (non-dry-run):
//   1. Reads every markdown file under knowledge/ (recursively, at any depth)
//      except REVIEW-FLAGS.md. The directory tree mirrors the inclusion
//      framework — official-health-body/<body>/, clinical-guidelines/<body>/,
//      peer-reviewed/ — but the tree is documentation for humans only: a
//      chunk's provenance still comes solely from its file's front-matter
//      `source`, never from its path, so a misfiled document is caught by
//      front-matter review, not silently re-attributed.
//   2. Chunks each file with scripts/chunker.ts. Any file whose front-matter
//      is missing/unapproved `source`, missing `approved: true`, or missing
//      a valid non-empty `scopes` list causes chunkMarkdownDocument() to
//      throw — that file (and the whole run) is HARD-REJECTED; nothing is
//      embedded or written until every file is valid, so a partially-broken
//      corpus can never be ingested.
//   3. Scans every chunk for diet/clinical numeric content (mg/dL, mL/min,
//      mmHg, %, nutrient amounts, eGFR/creatinine/sensitivity-style figures)
//      and cross-references knowledge/REVIEW-FLAGS.md: a flagged chunk whose
//      source file is NOT even mentioned in REVIEW-FLAGS.md means a clinical
//      claim exists that nobody has logged for adviser review yet — that is
//      a hard block. A flagged chunk whose file IS referenced in
//      REVIEW-FLAGS.md is treated as already tracked for adviser sign-off;
//      it is still printed to the console on every run so a human sees
//      exactly what clinical content is about to be embedded.
//   4. Embeds every surviving chunk with Gemini (embedText, RETRIEVAL_DOCUMENT)
//      and rebuilds public.knowledge_chunks (delete all, then batch insert)
//      via supabase-js using parameterized client calls only — never
//      string-built SQL.
//
// --dry-run: performs steps 1-3 only (chunk + validate + print a per-file /
// per-chunk stats table). NO network call and NO Deno.env read for
// credentials happens in this mode.
//
// Run (Deno; only after checkpoint approval):
//   deno run --allow-read --allow-env --allow-net scripts/ingest-knowledge.ts
//   deno run --allow-read scripts/ingest-knowledge.ts --dry-run
//
// Required env for a real run (never for --dry-run):
//   GEMINI_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { chunkMarkdownDocument, type MarkdownChunk } from "./chunker.ts";
import { embedText } from "../supabase/functions/_shared/embeddings.ts";

const KNOWLEDGE_DIR = new URL("../knowledge/", import.meta.url);
const REVIEW_FLAGS_FILENAME = "REVIEW-FLAGS.md";

const DRY_RUN = Deno.args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Step 1 — load knowledge/*.md (everything except REVIEW-FLAGS.md)
// ---------------------------------------------------------------------------

interface LoadedFile {
  /** Path relative to knowledge/, e.g. official-health-body/who/foo.md.
   * Forward slashes on every platform so console output and the
   * REVIEW-FLAGS.md cross-reference read the same everywhere. */
  filename: string;
  text: string;
}

/** Collects every *.md path under `dir` (recursively), relative to
 * knowledge/. REVIEW-FLAGS.md is the ledger, not corpus content, so it is
 * skipped wherever it appears. */
async function collectMarkdownPaths(
  dir: URL,
  prefix: string,
  out: string[],
): Promise<void> {
  const entries = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      await collectMarkdownPaths(new URL(`${entry.name}/`, dir), relative, out);
      continue;
    }
    if (!entry.isFile) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    if (entry.name === REVIEW_FLAGS_FILENAME) continue;
    out.push(relative);
  }
}

async function loadKnowledgeFiles(): Promise<LoadedFile[]> {
  const names: string[] = [];
  await collectMarkdownPaths(KNOWLEDGE_DIR, "", names);
  names.sort();
  const files: LoadedFile[] = [];
  for (const name of names) {
    const text = await Deno.readTextFile(new URL(name, KNOWLEDGE_DIR));
    files.push({ filename: name, text });
  }
  return files;
}

async function loadReviewFlagsDocumentedFiles(): Promise<Set<string>> {
  let text: string;
  try {
    text = await Deno.readTextFile(
      new URL(REVIEW_FLAGS_FILENAME, KNOWLEDGE_DIR),
    );
  } catch {
    // No REVIEW-FLAGS.md at all means nothing is documented — every
    // clinically-flagged chunk will hard-block below, which is the correct,
    // conservative behavior.
    return new Set();
  }
  const documented = new Set<string>();
  // Paths are nested now (knowledge/<category>/<body>/<file>.md), so the
  // captured group spans slashes. A stale flat reference simply fails to
  // match, which blocks ingestion rather than waving the file through —
  // the fail-safe direction.
  const re = /knowledge\/([A-Za-z0-9._\-\/]+\.md)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    documented.add(match[1]);
  }
  return documented;
}

// ---------------------------------------------------------------------------
// Step 2 — chunk + hard-reject invalid files
// ---------------------------------------------------------------------------

interface ChunkedFile {
  filename: string;
  chunks: MarkdownChunk[];
}

interface Rejection {
  filename: string;
  message: string;
}

function chunkAllFiles(
  files: LoadedFile[],
): { chunked: ChunkedFile[]; rejections: Rejection[] } {
  const chunked: ChunkedFile[] = [];
  const rejections: Rejection[] = [];
  for (const file of files) {
    try {
      const chunks = chunkMarkdownDocument(file.text);
      chunked.push({ filename: file.filename, chunks });
    } catch (err) {
      rejections.push({
        filename: file.filename,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { chunked, rejections };
}

// ---------------------------------------------------------------------------
// Step 3 — diet/clinical-value detection + REVIEW-FLAGS.md cross-reference
// ---------------------------------------------------------------------------

// Numeric clinical values with a unit (eGFR/creatinine ranges, blood
// pressure, lab values, percentages, gram/energy/dose amounts). This is an
// ASSISTIVE net, not a substitute for a full manual read of every file
// before the ingestion checkpoint is approved — spelled-out numbers or an
// unlisted unit can still slip past it.
const CLINICAL_UNIT_PATTERN =
  /\d+(\.\d+)?\s*(mg\/dL|mL\/min(?:\/1\.73\s*m²?)?|mmHg|mmol\/L|mmol\b|mEq\/L|%|percent\b|g\/day|grams?\b|kcal\b|calories\b|mcg\b|µg\b|IU\b|L\/day|liters?\b|litres?\b|mg\b|ml\b|oz\b|ounces?\b)/i;

// Clinical/statistical keywords that are only sensitive when paired with an
// actual number nearby (e.g. "eGFR 90", "sensitivity ~92%", "cutoff of 4").
//
// `age` is on this list because the SCORED age thresholds (50 / 60 / 70+)
// are exactly the kind of number that drives what BATO tells a user — see
// REVIEW-FLAGS.md §3. It was caught incidentally while the nine risk factors
// shared one chunk with the accuracy percentages; splitting them into one
// section per factor (2026-08-06) isolated it, and without this keyword the
// age chunk would pass the net unflagged.
const CLINICAL_KEYWORD_NEAR_NUMBER =
  /\b(eGFR|GFR|creatinine|albumin|ACR|uACR|sensitivity|specificity|PPV|NPV|cutoff|threshold|blood\s+pressure|A1C|HbA1c|age)\b[\s\S]{0,40}?\d/i;

// Diet/nutrient keywords are only flagged when a specific quantity is given
// alongside them — purely qualitative diet guidance ("less salt", "may be
// advised on how much protein") is NOT flagged (see REVIEW-FLAGS.md §6).
const NUTRIENT_KEYWORD = /\b(sodium|potassium|phosphorus|protein|salt|fluids?|calcium)\b/i;

function isClinicallySensitive(content: string): boolean {
  if (CLINICAL_UNIT_PATTERN.test(content)) return true;
  if (CLINICAL_KEYWORD_NEAR_NUMBER.test(content)) return true;
  if (NUTRIENT_KEYWORD.test(content) && /\d/.test(content)) return true;
  return false;
}

interface FlaggedChunk {
  filename: string;
  chunk: MarkdownChunk;
}

function flagClinicalChunks(chunked: ChunkedFile[]): FlaggedChunk[] {
  const flagged: FlaggedChunk[] = [];
  for (const file of chunked) {
    for (const chunk of file.chunks) {
      if (isClinicallySensitive(chunk.content)) {
        flagged.push({ filename: file.filename, chunk });
      }
    }
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printRejections(rejections: Rejection[]) {
  console.error(
    `\n✖ ${rejections.length} file(s) HARD-REJECTED — fix before ingesting:\n`,
  );
  for (const r of rejections) {
    console.error(`  - ${r.filename}: ${r.message}`);
  }
}

function printFlaggedChunks(flagged: FlaggedChunk[]) {
  if (flagged.length === 0) {
    console.log("\nNo diet/clinical-value chunks detected.");
    return;
  }
  console.log(
    `\n⚠ ${flagged.length} chunk(s) contain diet/clinical numeric values ` +
      "(for adviser awareness):\n",
  );
  console.table(
    flagged.map((f) => ({
      file: f.filename,
      source: f.chunk.source,
      heading_path: f.chunk.heading_path,
      chars: f.chunk.content.length,
    })),
  );
}

function printStatsTable(chunked: ChunkedFile[], flagged: FlaggedChunk[]) {
  const flaggedByFile = new Map<string, number>();
  for (const f of flagged) {
    flaggedByFile.set(f.filename, (flaggedByFile.get(f.filename) ?? 0) + 1);
  }
  console.log("\nPer-file chunk stats:\n");
  console.table(
    chunked.map((f) => {
      const totalChars = f.chunks.reduce((sum, c) => sum + c.content.length, 0);
      return {
        file: f.filename,
        chunks: f.chunks.length,
        total_chars: totalChars,
        avg_chars: f.chunks.length > 0
          ? Math.round(totalChars / f.chunks.length)
          : 0,
        flagged: flaggedByFile.get(f.filename) ?? 0,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Embedding rate control
//
// The free tier meters embeddings at 100 requests per minute per model, and
// this corpus is already larger than that. The first full ingestion run blew
// the quota around chunk 100 of 121 and aborted.
//
// It aborted harmlessly, and that is worth stating because it is a property
// of the ordering above rather than luck: every chunk is embedded into `rows`
// BEFORE the delete-and-insert, so a failure anywhere in the embedding pass
// leaves the live table untouched. Keep that ordering — moving the delete
// earlier would turn a quota error into an emptied corpus.
//
// Pacing goes here rather than in _shared/embeddings.ts because that module
// is also on the live query path, where a deliberate sleep before every
// request would add latency to user-facing retrieval for no benefit. The
// batch caller is the one with a rate problem, so the batch caller solves it.
// ---------------------------------------------------------------------------

/** ~85 requests/minute, comfortably under the 100/min free-tier ceiling. */
const EMBED_MIN_INTERVAL_MS = 700;

/** How many times to retry a single chunk that hits the quota. */
const EMBED_MAX_ATTEMPTS = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeds one chunk, waiting out quota errors rather than failing the run.
 *
 * Google states the wait in the error body ("retryDelay": "27s"). Reading it
 * beats guessing — the same lesson the scraper learned against Firecrawl,
 * where blind exponential backoff was shorter than the stated window and
 * burned every retry without ever waiting long enough.
 */
async function embedWithRetry(text: string): Promise<number[]> {
  for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
    try {
      return await embedText({ text, taskType: "RETRIEVAL_DOCUMENT" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isQuota = /\b429\b/.test(message) ||
        /RESOURCE_EXHAUSTED/i.test(message);
      if (!isQuota || attempt === EMBED_MAX_ATTEMPTS) throw err;

      const stated = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(message);
      // Server's number plus slack, so we do not land on the boundary and
      // immediately hit the same limit again.
      const waitMs = stated ? Number(stated[1]) * 1000 + 3000 : 35_000;
      console.warn(
        `  quota reached — waiting ${Math.round(waitMs / 1000)}s ` +
          `(attempt ${attempt}/${EMBED_MAX_ATTEMPTS})`,
      );
      await delay(waitMs);
    }
  }
  throw new Error("embedWithRetry: exhausted attempts without returning");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = await loadKnowledgeFiles();
  console.log(`Found ${files.length} knowledge file(s) (excluding ${REVIEW_FLAGS_FILENAME}).`);

  const { chunked, rejections } = chunkAllFiles(files);

  if (rejections.length > 0) {
    printRejections(rejections);
    console.error(
      "\nAborting: fix the file(s) above (unapproved/missing source, or " +
        "approved != true) before running ingestion again. No chunk from " +
        "any file was embedded or written.",
    );
    Deno.exit(1);
  }

  const flagged = flagClinicalChunks(chunked);
  const documentedFiles = await loadReviewFlagsDocumentedFiles();
  const undocumented = flagged.filter(
    (f) => !documentedFiles.has(f.filename),
  );

  printFlaggedChunks(flagged);
  printStatsTable(chunked, flagged);

  if (undocumented.length > 0) {
    console.error(
      `\n✖ ${undocumented.length} clinically-flagged chunk(s) come from ` +
        `file(s) NOT referenced in knowledge/${REVIEW_FLAGS_FILENAME}:\n`,
    );
    for (const f of undocumented) {
      console.error(
        `  - ${f.filename} — "${f.chunk.heading_path}" (source: ${f.chunk.source})`,
      );
    }
    console.error(
      `\nAborting: add these to knowledge/${REVIEW_FLAGS_FILENAME} and get ` +
        "adviser sign-off before ingesting. Diet/clinical content is never " +
        "silently ingested (hardened RAG spec §3.3).",
    );
    Deno.exit(1);
  }

  const totalChunks = chunked.reduce((sum, f) => sum + f.chunks.length, 0);

  if (DRY_RUN) {
    console.log(
      `\nDRY RUN — ${totalChunks} chunk(s) across ${chunked.length} file(s) ` +
        "validated. No embedding call and no database call were made.",
    );
    return;
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!geminiKey) {
    console.error("Missing env: GEMINI_API_KEY is required.");
    Deno.exit(1);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Missing env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
    Deno.exit(1);
  }

  // Deferred import: supabase-js is only needed for a real run, keeping
  // --dry-run free of any network-capable dependency load side effects.
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(`\nEmbedding ${totalChunks} chunk(s)…`);

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let embedded = 0;
  for (const file of chunked) {
    for (const chunk of file.chunks) {
      // Pace every call after the first. Without this the run dies partway
      // through: the free tier allows 100 embedding requests per minute and
      // this corpus is already past that, so an unpaced loop exhausts the
      // quota around chunk 100 and throws.
      if (embedded > 0) await delay(EMBED_MIN_INTERVAL_MS);
      const embedding = await embedWithRetry(chunk.content);
      embedded++;
      rows.push({
        source: chunk.source,
        title: chunk.title,
        heading_path: chunk.heading_path,
        content: chunk.content,
        // pgvector accepts the bracketed text form; stringify the float array.
        embedding: JSON.stringify(embedding),
        topic_tags: chunk.topic_tags,
        // Validated by the chunker and re-checked by the column's CHECK
        // constraint. No default exists on either side: an untagged chunk
        // fails loudly rather than landing in the wrong corpus.
        scopes: chunk.scopes,
        last_updated: now,
      });
      console.log(
        `  [${String(embedded).padStart(3)}/${totalChunks}] ${chunk.source} — ` +
          `${chunk.heading_path} [${chunk.scopes.join(", ")}]`,
      );
    }
  }

  // Rebuild the tier: clear, then insert, so the table mirrors knowledge/*.md
  // exactly on every run. Scoped strictly to knowledge_chunks (the filter is
  // a no-op predicate that matches every row; id is never null).
  const { error: delError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .not("id", "is", null);
  if (delError) {
    console.error("Failed to clear knowledge_chunks:", delError.message);
    Deno.exit(1);
  }

  const { data, error: insError } = await supabase
    .from("knowledge_chunks")
    .insert(rows)
    .select("id");
  if (insError) {
    console.error("Insert failed:", insError.message);
    Deno.exit(1);
  }

  console.log(`Done. Inserted ${data?.length ?? rows.length} chunks.`);

  // ---------------------------------------------------------------------
  // Invalidate the answer cache.
  //
  // A cached reply is served VERBATIM — it bypasses retrieval entirely, which
  // is the whole point of the cache and also precisely why it cannot outlive
  // the corpus it was grounded in. Every row in answer_cache was generated
  // from the chunks that were just deleted, so leaving them in place means
  // answering today's questions out of yesterday's evidence with no stage
  // downstream able to notice.
  //
  // That is not hypothetical here: the corpus this run replaced held four
  // distinct sources, and the one it installed holds thirteen, including the
  // Philippine material (DOH, PHESRD, PSH) that a cached answer about local
  // dialysis access could not possibly have cited.
  //
  // Dropping the rows costs nothing. A cache is a derived artefact — anything
  // discarded is regenerated on the next ask, at the price of one generation
  // call — whereas serving a stale grounded answer is a correctness failure.
  // ---------------------------------------------------------------------
  const { error: cacheError } = await supabase
    .from("answer_cache")
    .delete()
    .not("id", "is", null);
  if (cacheError) {
    // Not fatal: the corpus is already correctly rebuilt, and a stale cache
    // is a quality problem rather than a broken one. Say so loudly instead
    // of failing a run that otherwise succeeded.
    console.error(
      `⚠ Failed to clear answer_cache: ${cacheError.message}\n` +
        "  The corpus was rebuilt, but cached replies still reflect the OLD " +
        "corpus. Clear public.answer_cache by hand before relying on results.",
    );
  } else {
    console.log(
      "Cleared answer_cache — cached replies were grounded in the previous " +
        "corpus and would otherwise be served verbatim.",
    );
  }
}

if (import.meta.main) {
  await main();
}
