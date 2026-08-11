// BATO — scrapes the approved knowledge-base sources into scraped/raw/.
//
// Stage 1 of two. This script ONLY fetches and stores verbatim output; it
// makes no editorial change to the text whatsoever. scripts/clean-scraped.ts
// is stage 2. Keeping them separate means a cleaning-rule bug is fixed and
// re-run for free, without re-fetching (and re-paying for) twenty documents —
// and it means the raw text stays on disk as the auditable record of what the
// publisher actually said.
//
// Output:
//   scraped/raw/<id>.md            verbatim Firecrawl markdown
//   scraped/raw/<id>.meta.json     URL, timestamp, Firecrawl metadata
//
// Usage:
//   deno task scrape:plan                 # no network; prints what would run
//   deno task scrape                      # everything not already fetched
//   deno task scrape -- --only=cdc-ckd-basics
//   deno task scrape -- --rank=1,2,3
//   deno task scrape -- --force           # re-fetch even if raw/ has it
//
// Required env: FIRECRAWL_API_KEY and/or TAVILY_API_KEY (see .env)
//
// Firecrawl is preferred; Tavily is the automatic fallback when Firecrawl
// fails or runs out of credits. Set SCRAPE_PROVIDER=tavily to skip Firecrawl
// entirely once its monthly credits are known to be spent.
//
// COST NOTE: every fetched URL spends one provider credit, and large PDFs
// can spend more. Already-scraped sources are skipped by default for exactly
// that reason — --force is opt-in.

import { FirecrawlError } from "./scrape/firecrawl.ts";
import { fetchUrl } from "./scrape/fetch-with-fallback.ts";
import { MANIFEST, type ManifestEntry } from "./scrape/manifest.ts";

const RAW_DIR = new URL("../scraped/raw/", import.meta.url);

const DRY_RUN = Deno.args.includes("--dry-run") || Deno.args.includes("--plan");
const FORCE = Deno.args.includes("--force");

/**
 * Gap between requests, in ms.
 *
 * Sized to Firecrawl's rate limit, not to politeness toward the publishers.
 * The free/hobby plan allows 10 requests per minute; the first full run used
 * 1500ms (40/min) and lost three sources to HTTP 429 despite retries. 7000ms
 * is roughly 8.5/min, which leaves headroom for the retry traffic that a 429
 * itself generates — retries count against the same bucket, so pacing exactly
 * at the limit still fails as soon as anything needs a second attempt.
 *
 * Override with FIRECRAWL_MIN_INTERVAL_MS on a plan with a higher limit.
 */
const INTER_REQUEST_DELAY_MS = (() => {
  try {
    const raw = Deno.env.get("FIRECRAWL_MIN_INTERVAL_MS");
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 7000;
  } catch {
    // `deno task scrape:plan` runs without --allow-env and never sleeps.
    return 7000;
  }
})();

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = Deno.args.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function selectEntries(): ManifestEntry[] {
  const only = argValue("only");
  const rank = argValue("rank");

  // Excluded entries are skipped even when named explicitly: a real scrape
  // already proved the URL returns a paywall stub or a page shell, so
  // re-running it only spends credits to fetch the same junk again.
  let selected = MANIFEST.filter(
    (e) => e.kind !== "local" && e.excluded === undefined,
  );

  if (only) {
    const ids = new Set(only.split(",").map((s) => s.trim()).filter(Boolean));
    const unknown = [...ids].filter((id) => !MANIFEST.some((e) => e.id === id));
    if (unknown.length > 0) {
      console.error(`Unknown --only id(s): ${unknown.join(", ")}`);
      console.error(`Valid ids: ${MANIFEST.map((e) => e.id).join(", ")}`);
      Deno.exit(1);
    }
    selected = selected.filter((e) => ids.has(e.id));
  }

  if (rank) {
    const ranks = new Set(
      rank.split(",").map((s) => Number(s.trim())).filter(Number.isFinite),
    );
    selected = selected.filter((e) => ranks.has(e.rank));
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

async function ensureRawDir(): Promise<void> {
  await Deno.mkdir(RAW_DIR, { recursive: true });
}

async function alreadyScraped(id: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(new URL(`${id}.md`, RAW_DIR));
    return stat.isFile && stat.size > 0;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type Outcome = "scraped" | "skipped" | "failed";

interface RunRow {
  rank: number;
  id: string;
  kind: string;
  outcome: Outcome;
  chars: number;
  detail: string;
}

const rows: RunRow[] = [];

function printPlan(entries: ManifestEntry[]): void {
  console.log(`\nPlan — ${entries.length} fetchable source(s):\n`);
  console.table(
    entries.map((e) => ({
      rank: e.rank,
      id: e.id,
      kind: e.kind,
      access: e.access,
      source_id: e.sourceId ?? "UNREGISTERED",
      url: e.url.length > 60 ? `${e.url.slice(0, 57)}…` : e.url,
    })),
  );

  const restricted = entries.filter((e) => e.access === "restricted");
  if (restricted.length > 0) {
    console.log(
      `\n${restricted.length} source(s) are marked restricted — a paywall or ` +
        `consent screen is the expected result there, not a failure to fix:`,
    );
    for (const e of restricted) console.log(`  - ${e.id}`);
  }

  const local = MANIFEST.filter((e) => e.kind === "local");
  if (local.length > 0) {
    console.log(`\nNot fetched (local project file):`);
    for (const e of local) console.log(`  - ${e.id} — ${e.notes ?? ""}`);
  }

  const excluded = MANIFEST.filter((e) => e.excluded !== undefined);
  if (excluded.length > 0) {
    console.log(`\nExcluded — a real scrape proved these cannot be automated:`);
    for (const e of excluded) console.log(`  - ${e.id}: ${e.excluded}`);
  }
}

function printSummary(): void {
  console.log("\nRun summary:\n");
  console.table(rows);
  const failed = rows.filter((r) => r.outcome === "failed");
  const scraped = rows.filter((r) => r.outcome === "scraped");
  console.log(
    `\n${scraped.length} scraped, ` +
      `${rows.filter((r) => r.outcome === "skipped").length} skipped, ` +
      `${failed.length} failed.`,
  );
  if (scraped.length > 0) {
    console.log(`\nRaw output in scraped/raw/. Next: deno task clean`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const entries = selectEntries();

  if (entries.length === 0) {
    console.error("No sources selected. Check --only / --rank filters.");
    Deno.exit(1);
  }

  if (DRY_RUN) {
    printPlan(entries);
    console.log(
      "\nDRY RUN — no network call was made and FIRECRAWL_API_KEY was not read.",
    );
    return;
  }

  printPlan(entries);
  await ensureRawDir();

  for (const entry of entries) {
    if (!FORCE && await alreadyScraped(entry.id)) {
      console.log(`↷ skip   ${entry.id} (already in scraped/raw/; --force to refetch)`);
      rows.push({
        rank: entry.rank,
        id: entry.id,
        kind: entry.kind,
        outcome: "skipped",
        chars: 0,
        detail: "already scraped",
      });
      continue;
    }

    console.log(`→ fetch  ${entry.id} (${entry.kind}) …`);
    const started = performance.now();

    try {
      const result = await fetchUrl(entry.url, {
        attempts: 3,
        onRetry: (attempt, waitMs, reason) => {
          console.warn(
            `  retry ${attempt} in ${waitMs}ms — ${reason.slice(0, 160)}`,
          );
        },
        onFallback: (reason) => {
          console.warn(`  falling back to Tavily — ${reason.slice(0, 160)}`);
        },
      });

      await Deno.writeTextFile(
        new URL(`${entry.id}.md`, RAW_DIR),
        result.markdown,
      );
      await Deno.writeTextFile(
        new URL(`${entry.id}.meta.json`, RAW_DIR),
        JSON.stringify(
          {
            id: entry.id,
            rank: entry.rank,
            title: entry.title,
            url: entry.url,
            kind: entry.kind,
            sourceId: entry.sourceId,
            licence: entry.licence,
            scrapedAt: new Date().toISOString(),
            provider: result.provider,
            targetStatusCode: result.statusCode ?? null,
            providerMetadata: result.metadata,
          },
          null,
          2,
        ) + "\n",
      );

      const ms = Math.round(performance.now() - started);
      console.log(
        `  ok — ${result.markdown.length.toLocaleString()} chars in ${ms}ms`,
      );
      rows.push({
        rank: entry.rank,
        id: entry.id,
        kind: entry.kind,
        outcome: "scraped",
        chars: result.markdown.length,
        detail: `${result.provider}, ${ms}ms`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // No usable key for EITHER provider is fatal for every remaining entry,
      // not just this one — stop rather than printing the same failure twenty
      // times. One key missing is not fatal: that is what the fallback is for.
      if (message.includes("FIRECRAWL_API_KEY") &&
        message.includes("TAVILY_API_KEY")) {
        console.error(`\n✖ No scrape provider is configured.\n${message}`);
        Deno.exit(1);
      }
      if (err instanceof FirecrawlError && err.status === null &&
        message.includes("FIRECRAWL_API_KEY")) {
        console.error(`\n✖ ${message}`);
        Deno.exit(1);
      }
      console.error(`  ✖ failed — ${message.slice(0, 300)}`);
      rows.push({
        rank: entry.rank,
        id: entry.id,
        kind: entry.kind,
        outcome: "failed",
        chars: 0,
        detail: message.slice(0, 120),
      });
    }

    await delay(INTER_REQUEST_DELAY_MS);
  }

  printSummary();
}

if (import.meta.main) {
  await main();
}
