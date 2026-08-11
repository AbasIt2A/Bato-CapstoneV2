// BATO — provider dispatch for the source scraper.
//
// Firecrawl is the primary because it produces cleaner markdown (onlyMainContent
// strips nav and footers at the source). Tavily is the fallback because
// Firecrawl's plan credits are a hard monthly ceiling — when they run out the
// API answers 402 and every remaining source in the run fails identically.
//
// The fallback fires only on provider-level failure, never on a legitimately
// empty result: a paywalled page is empty from BOTH providers, so retrying it
// on Tavily spends a second credit to learn what we already knew.

import { FirecrawlError, type ScrapeResult, scrapeUrl } from "./firecrawl.ts";
import { extractUrl, TavilyError } from "./tavily.ts";

export type Provider = "firecrawl" | "tavily";

export interface FetchOutcome extends ScrapeResult {
  /** Which provider actually produced this text. Recorded in the .meta.json
   *  so a later reader can explain why one file is noisier than its neighbours. */
  provider: Provider;
}

/**
 * True when falling back to a second provider could plausibly help.
 *
 * A missing key, a 402 out-of-credits, a 429, a timeout — all worth trying
 * elsewhere. A page that genuinely returned nothing is not: it will return
 * nothing again.
 */
function worthFallingBack(err: unknown): boolean {
  if (err instanceof FirecrawlError) {
    // "returned no markdown" is the paywall/consent case — the URL is the
    // problem, not the provider.
    if (err.message.includes("no markdown")) return false;
    return true;
  }
  return true;
}

export interface FetchOptions {
  attempts?: number;
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
  onFallback?: (reason: string) => void;
}

/**
 * Fetches one URL, preferring Firecrawl and falling back to Tavily.
 *
 * Set SCRAPE_PROVIDER=tavily to skip Firecrawl entirely — useful once the
 * month's Firecrawl credits are known to be gone, since it saves one doomed
 * request and its retries per source.
 */
export async function fetchUrl(
  url: string,
  options: FetchOptions = {},
): Promise<FetchOutcome> {
  const { attempts = 3, onRetry, onFallback } = options;
  const forced = Deno.env.get("SCRAPE_PROVIDER");

  if (forced === "tavily") {
    return { ...await extractUrl(url), provider: "tavily" };
  }

  try {
    return { ...await scrapeUrl(url, attempts, onRetry), provider: "firecrawl" };
  } catch (err) {
    if (forced === "firecrawl" || !worthFallingBack(err)) throw err;

    const reason = err instanceof Error ? err.message : String(err);
    onFallback?.(reason);

    try {
      return { ...await extractUrl(url), provider: "tavily" };
    } catch (fallbackErr) {
      // Surface BOTH failures. Reporting only Tavily's "missing TAVILY_API_KEY"
      // would hide that the real problem was Firecrawl running out of credits.
      const fallbackReason = fallbackErr instanceof Error
        ? fallbackErr.message
        : String(fallbackErr);
      throw new TavilyError(
        `Both providers failed for ${url}.\n` +
          `  firecrawl: ${reason.slice(0, 200)}\n` +
          `  tavily:    ${fallbackReason.slice(0, 200)}`,
        null,
        false,
      );
    }
  }
}
