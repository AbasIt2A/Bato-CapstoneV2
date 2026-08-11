// BATO — Tavily extract client, the fallback for scripts/scrape/firecrawl.ts.
//
// Exists because Firecrawl's plan credits are a hard monthly ceiling: when
// they run out mid-run, every remaining source fails on a 402 and the corpus
// is left half-fetched. Tavily's /extract does the same job — URL in, markdown
// out, PDFs parsed server-side — so a second provider turns "the run died at
// source 12 of 20" into a slower but complete run.
//
// Deliberately NOT a drop-in equal of Firecrawl. Two differences matter:
//
//   1. No `onlyMainContent`. Tavily returns the whole page including nav,
//      cookie banners and footers. That is tolerable only because clean-scraped.ts
//      runs a boilerplate pass anyway — but expect noisier raw/ files from this
//      path, and expect the cleaner to be doing more of the work.
//   2. Images arrive as inline base64 data: URIs, which can add tens of KB of
//      unreadable text per page. stripDataUris drops them before we ever write
//      to disk; leaving them in would bloat the raw file and, worse, survive
//      into chunks as meaningless embedded tokens.
//
// Returns the same ScrapeResult shape as firecrawl.ts so the caller does not
// branch on which provider answered.
//
// Required env:
//   TAVILY_API_KEY         — your Tavily key
// Optional env:
//   TAVILY_API_BASE        — default https://api.tavily.com

import { type ScrapeResult, SCRAPE_TIMEOUT_MS } from "./firecrawl.ts";

const DEFAULT_BASE = "https://api.tavily.com";

export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

function apiKey(): string {
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key || key.trim().length === 0) {
    throw new TavilyError(
      "Missing env: TAVILY_API_KEY is required for the Tavily fallback. Add " +
        "it to .env (the file is gitignored) and re-run.",
      null,
      false,
    );
  }
  return key.trim();
}

function apiBase(): string {
  return (Deno.env.get("TAVILY_API_BASE") ?? DEFAULT_BASE).replace(/\/+$/, "");
}

/**
 * Removes inline base64 data: URIs from markdown.
 *
 * Tavily inlines page images as `![alt](data:image/png;base64,iVBOR…)`, which
 * on a government page with flags and seals is routinely 20-40KB of text that
 * carries no meaning. The alt text is kept — it is occasionally the only label
 * on a figure — but the payload goes.
 */
export function stripDataUris(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, (_m, alt: string) => alt ? `![${alt}]()` : "")
    .replace(/\(data:[^)]*\)/g, "()");
}

/** 429 and 5xx are worth another attempt; 401/402/404 are not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Extracts one URL via Tavily.
 *
 * Tavily reports per-URL failure inside a 200 response (`failed_results`)
 * rather than as an HTTP error, so a successful-looking response still has to
 * be inspected before it is trusted.
 */
export async function extractUrl(url: string): Promise<ScrapeResult> {
  const response = await fetch(`${apiBase()}/extract`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: [url],
      format: "markdown",
      // "advanced" costs more per call but is the only depth that reliably
      // returns tables and PDF body text — both of which this corpus is
      // largely made of (staging tables, dietary limits, prevalence figures).
      extract_depth: "advanced",
    }),
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TavilyError(
      `Tavily returned HTTP ${response.status}: ${body.slice(0, 400)}`,
      response.status,
      isRetryableStatus(response.status),
    );
  }

  const json = await response.json();
  const results = Array.isArray(json?.results) ? json.results : [];

  if (results.length === 0) {
    const failure = Array.isArray(json?.failed_results) ? json.failed_results[0] : null;
    throw new TavilyError(
      `Tavily could not extract ${url}: ${failure?.error ?? "(no reason given)"}`,
      null,
      false,
    );
  }

  const markdown = stripDataUris(
    typeof results[0].raw_content === "string" ? results[0].raw_content : "",
  );

  if (markdown.trim().length === 0) {
    throw new TavilyError(
      `Tavily returned no content for ${url}. For a paywalled or ` +
        "consent-gated source this is the expected result, not a bug.",
      null,
      false,
    );
  }

  return {
    markdown,
    metadata: {
      title: results[0].title ?? null,
      sourceURL: results[0].url ?? url,
      provider: "tavily",
    },
  };
}
