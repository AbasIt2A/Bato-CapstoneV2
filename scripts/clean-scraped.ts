// BATO — cleans scraped/raw/ into scraped/clean/.
//
// Stage 2 of two (scripts/scrape-sources.ts is stage 1). Offline and
// idempotent: it reads local files, applies scripts/scrape/cleaner.ts, and
// writes candidate knowledge documents with generated front-matter. No
// network, no database, no API key.
//
// WHERE THE OUTPUT GOES, AND WHY NOT knowledge/
//
// Cleaned files land in scraped/clean/, NOT in knowledge/. Everything under
// knowledge/ is picked up automatically by scripts/ingest-knowledge.ts, and
// nothing machine-generated belongs on that path. A cleaned file is a
// candidate: a human reads it, cuts it down to the passages worth embedding,
// writes real section headings, checks every clinical number against the
// source PDF, logs those numbers in knowledge/REVIEW-FLAGS.md, gets adviser
// sign-off, and only then moves it under knowledge/<category>/<body>/ and
// flips `approved: false` to true.
//
// Every file this script writes therefore carries `approved: false`, and
// chunkMarkdownDocument() hard-rejects it in that state. That rejection is
// the feature.
//
// Usage:
//   deno task clean
//   deno task clean -- --only=kdigo-2024-ckd-guideline
//   deno task clean -- --strict        # exit 1 if any document warns
//   deno task clean -- --verbose       # print every rule's samples

import { cleanDocument, type CleanReport } from "./scrape/cleaner.ts";
import { entryById, MANIFEST } from "./scrape/manifest.ts";
import { chunkMarkdownDocument } from "./chunker.ts";

const RAW_DIR = new URL("../scraped/raw/", import.meta.url);
const CLEAN_DIR = new URL("../scraped/clean/", import.meta.url);

const STRICT = Deno.args.includes("--strict");
const VERBOSE = Deno.args.includes("--verbose");
const CHUNKS = Deno.args.includes("--chunks");

/**
 * What the chunker would actually produce from a cleaned document.
 *
 * File size and heading counts are proxies; THIS is the thing that decides
 * retrieval quality, because a chunk is what gets embedded and returned. A
 * 900 KB document that yields four 200 KB chunks is not a usable source no
 * matter how clean its text is — each chunk would be a diluted average of
 * everything in it. Run with --chunks before deciding a source is ready.
 *
 * `approved: false` is flipped in memory only, purely so the chunker will
 * run. Nothing is written and no approval is implied.
 */
interface ChunkStats {
  count: number;
  median: number;
  max: number;
  /** Chunks past the chunker's own 2500-char section threshold. */
  oversized: number;
  largest: string;
}

function previewChunks(markdown: string): ChunkStats | { error: string } {
  try {
    const chunks = chunkMarkdownDocument(
      markdown.replace("approved: false", "approved: true"),
    );
    if (chunks.length === 0) return { error: "produced no chunks" };
    const sizes = chunks.map((c) => c.content.length).sort((a, b) => a - b);
    const biggest = chunks.reduce((a, b) =>
      b.content.length > a.content.length ? b : a
    );
    return {
      count: chunks.length,
      median: sizes[Math.floor(sizes.length / 2)],
      max: sizes[sizes.length - 1],
      oversized: sizes.filter((s) => s > 2500).length,
      largest: biggest.heading_path,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** Today as YYYY-MM-DD, matching the front-matter convention in knowledge/. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Input discovery
// ---------------------------------------------------------------------------

interface RawFile {
  /** Slug — the filename without .md. Matched against the manifest. */
  id: string;
  text: string;
}

async function loadRawFiles(): Promise<RawFile[]> {
  const only = argValue("only");
  const wanted = only
    ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const files: RawFile[] = [];
  try {
    for await (const entry of Deno.readDir(RAW_DIR)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".md")) continue; // skips the .meta.json sidecars
      const id = entry.name.slice(0, -3);
      if (wanted && !wanted.has(id)) continue;
      files.push({
        id,
        text: await Deno.readTextFile(new URL(entry.name, RAW_DIR)),
      });
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.error(
        "scraped/raw/ does not exist. Run `deno task scrape` first (or drop " +
          "manually-obtained text there as <slug>.md).",
      );
      Deno.exit(1);
    }
    throw err;
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  return files;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(id: string, report: CleanReport): void {
  const pct = Math.round(report.retainedRatio * 100);
  console.log(
    `\n${id}\n  ${report.rawChars.toLocaleString()} → ` +
      `${report.cleanChars.toLocaleString()} chars (${pct}% retained)  ` +
      `H1:${report.headings.h1} H2:${report.headings.h2} H3:${report.headings.h3}`,
  );

  const fired = report.effects.filter((e) => e.charsRemoved !== 0);
  if (fired.length > 0) {
    // Signed: a rule can legitimately ADD characters (a ligature expands ﬁ to
    // two), and printing that as "--3" reads like a broken counter.
    const summary = fired
      .map((e) =>
        `${e.rule} (${e.charsRemoved > 0 ? "-" : "+"}${Math.abs(e.charsRemoved)})`
      )
      .join(", ");
    console.log(`  rules: ${summary}`);
  }

  if (VERBOSE) {
    for (const effect of report.effects) {
      if (effect.samples.length === 0) continue;
      console.log(`    ${effect.rule}:`);
      for (const sample of effect.samples) {
        console.log(`      · ${sample}`);
      }
    }
  }

  for (const warning of report.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawFiles = await loadRawFiles();
  if (rawFiles.length === 0) {
    console.error(
      "No raw files to clean. Run `deno task scrape` first, or check --only.",
    );
    Deno.exit(1);
  }

  await Deno.mkdir(CLEAN_DIR, { recursive: true });

  console.log(`Cleaning ${rawFiles.length} raw file(s)…`);

  const rows: Record<string, unknown>[] = [];
  let warningCount = 0;
  let unmatched = 0;

  for (const raw of rawFiles) {
    const entry = entryById(raw.id);

    if (!entry) {
      // A file dropped into scraped/raw/ by hand (library PDF text, the
      // SCORED paper). Clean it on PDF rules — the conservative choice, since
      // running PDF repair on already-clean text is close to a no-op, while
      // skipping it on genuine PDF text leaves hyphen-split words behind.
      unmatched++;
      console.warn(
        `\n⚠ ${raw.id} is not in the manifest — cleaning with PDF defaults ` +
          `and source: UNREGISTERED. Add it to scripts/scrape/manifest.ts to ` +
          `give it a real source ID, scopes and tags.`,
      );
    }

    const result = cleanDocument(raw.text, {
      kind: entry?.kind ?? "pdf",
      title: entry?.title ?? raw.id,
      sourceId: entry?.sourceId ?? null,
      scopes: entry?.scopes ?? ["general_education"],
      topicTags: entry?.topicTags ?? [],
      url: entry?.url || undefined,
      retrievedOn: today(),
    });

    await Deno.writeTextFile(
      new URL(`${raw.id}.md`, CLEAN_DIR),
      result.markdown,
    );

    printReport(raw.id, result.report);
    warningCount += result.report.warnings.length;

    const row: Record<string, unknown> = {
      id: raw.id,
      source: entry?.sourceId ?? "UNREGISTERED",
      raw_chars: result.report.rawChars,
      clean_chars: result.report.cleanChars,
      retained: `${Math.round(result.report.retainedRatio * 100)}%`,
      h2: result.report.headings.h2,
      warnings: result.report.warnings.length,
    };

    if (CHUNKS) {
      const stats = previewChunks(result.markdown);
      if ("error" in stats) {
        row.chunks = `✖ ${stats.error.slice(0, 40)}`;
        console.warn(`  ✖ chunk preview failed: ${stats.error}`);
      } else {
        row.chunks = stats.count;
        row.median_chunk = stats.median;
        row.max_chunk = stats.max;
        row.oversized = stats.oversized;
        console.log(
          `  chunks: ${stats.count} (median ${stats.median}, max ${stats.max}` +
            `, ${stats.oversized} over 2500)`,
        );
        if (stats.max > 20000) {
          console.warn(
            `  ⚠ largest chunk is ${stats.max} chars — "${stats.largest}". ` +
              `A chunk this size embeds as an average of everything in it ` +
              `and will retrieve poorly; it needs subsection headings.`,
          );
          warningCount++;
        }
      }
    }

    rows.push(row);
  }

  console.log("\nPer-file summary:\n");
  console.table(rows);

  const missing = MANIFEST.filter(
    (e) => !rawFiles.some((r) => r.id === e.id),
  );
  if (missing.length > 0 && !argValue("only")) {
    console.log(
      `\n${missing.length} manifest source(s) have no raw file yet: ` +
        missing.map((e) => e.id).join(", "),
    );
  }

  console.log(
    `\nWrote ${rawFiles.length} file(s) to scraped/clean/ with ` +
      `approved: false.\n` +
      `These are CANDIDATES, not corpus. Curate, verify every clinical ` +
      `number, log it in knowledge/REVIEW-FLAGS.md, get adviser sign-off, ` +
      `then move the file under knowledge/ and set approved: true.`,
  );

  if (unmatched > 0) {
    console.log(`\n${unmatched} file(s) had no manifest entry.`);
  }

  if (STRICT && warningCount > 0) {
    console.error(`\n✖ --strict: ${warningCount} warning(s) across the run.`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
