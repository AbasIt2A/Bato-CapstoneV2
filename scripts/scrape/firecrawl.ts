// BATO — minimal Firecrawl client for the knowledge-base scraper.
//
// Firecrawl handles both halves of the job behind one endpoint: it renders
// HTML pages to markdown, and it parses PDFs server-side. That is why it is
// worth a dependency here — a hand-rolled scraper would need a headless
// browser for the first and a PDF text extractor for the second, and the PDF
// half is where naive extraction produces the ligature/hyphenation/column
// garbage that cleaner.ts exists to undo.
//
// Not import-time pure: reads FIRECRAWL_API_KEY lazily, inside the request
// function only, so importing this module in a test or a --dry-run costs
// nothing and needs no --allow-env.
//
// Required env:
//   FIRECRAWL_API_KEY      — your Firecrawl key
// Optional env:
//   FIRECRAWL_API_BASE     — default https://api.firecrawl.dev/v2

const DEFAULT_BASE = "https://api.firecrawl.dev/v2";

/** Per-request ceiling. PDFs of 100+ pages genuinely take minutes, so this is
 *  far longer than the 10-30s timeouts used elsewhere in the project. */
export const SCRAPE_TIMEOUT_MS = 300_000;

/** How long Firecrawl itself should spend before giving up (ms), sent in the
 *  request body. Kept under our own AbortSignal so the server's error message
 *  wins the race and we get a reason rather than a bare abort. */
const SERVER_TIMEOUT_MS = 240_000;

export interface ScrapeResult {
  markdown: string;
  /** Whatever metadata Firecrawl returned — title, sourceURL, statusCode… */
  metadata: Record<string, unknown>;
  /** HTTP status the target returned, when Firecrawl reports it. */
  statusCode?: number;
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True when retrying the identical request could plausibly succeed. */
    readonly retryable: boolean,
    /** Server-stated wait before retrying, in ms, when it gave one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

/**
 * How long the server says to wait before retrying.
 *
 * Firecrawl states this twice and neither is the standard header alone: a
 * `Retry-After` header when it feels like it, and always a "please retry
 * after 18s" clause inside the JSON error body. Guessing instead of reading
 * it is what made the first full run fail — blind 2s and 4s backoffs against
 * an 18-second window burned both retries and dropped three sources.
 */
export function retryAfterMs(response: Response, body: string): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
  }
  const stated = /retry\s+after\s+(\d+(?:\.\d+)?)\s*s/i.exec(body);
  if (stated) return Math.ceil(Number(stated[1]) * 1000);
  return null;
}

function apiKey(): string {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key || key.trim().length === 0) {
    throw new FirecrawlError(
      "Missing env: FIRECRAWL_API_KEY is required to scrape. Add it to .env " +
        "(the file is gitignored) and re-run.",
      null,
      false,
    );
  }
  return key.trim();
}

function apiBase(): string {
  return (Deno.env.get("FIRECRAWL_API_BASE") ?? DEFAULT_BASE).replace(/\/+$/, "");
}

/**
 * Pulls the markdown out of a Firecrawl response.
 *
 * v1 and v2 both nest it under `data`, but self-hosted deployments and older
 * versions have shipped it at the top level. Checking both costs two lines
 * and turns "the scraper silently produced empty files" into a non-event.
 */
function extractPayload(json: unknown): { markdown: string; metadata: Record<string, unknown> } {
  const root = (json ?? {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string"
    ? data.markdown
    : typeof data.content === "string"
    ? data.content
    : "";
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return { markdown, metadata };
}

/** 429 and 5xx are worth another attempt; 401/403/404 are not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

async function scrapeOnce(url: string): Promise<ScrapeResult> {
  const response = await fetch(`${apiBase()}/scrape`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      // markdown only. Firecrawl can also return raw HTML and screenshots;
      // neither is useful to a text-retrieval corpus and both inflate the
      // raw files enormously.
      formats: ["markdown"],
      // Drops nav, headers, footers and sidebars at the source. The cleaner
      // still runs its own boilerplate pass — this flag is good but not
      // exhaustive, and it does nothing at all for PDFs.
      onlyMainContent: true,
      timeout: SERVER_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new FirecrawlError(
      `Firecrawl returned HTTP ${response.status}: ${body.slice(0, 400)}`,
      response.status,
      isRetryableStatus(response.status),
      retryAfterMs(response, body),
    );
  }

  const json = await response.json();
  if (json && json.success === false) {
    throw new FirecrawlError(
      `Firecrawl reported failure: ${json.error ?? "(no error message)"}`,
      null,
      false,
    );
  }

  const { markdown, metadata } = extractPayload(json);
  const statusCode = typeof metadata.statusCode === "number"
    ? metadata.statusCode
    : undefined;

  if (markdown.trim().length === 0) {
    throw new FirecrawlError(
      `Firecrawl returned no markdown for ${url}` +
        (statusCode ? ` (target responded ${statusCode})` : "") +
        ". For a paywalled or consent-gated source this is the expected " +
        "result, not a bug — obtain the text through library access instead.",
      null,
      false,
    );
  }

  return { markdown, metadata, statusCode };
}

/** Sleep helper — used only for backoff between failed attempts. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrapes one URL, retrying transient failures with exponential backoff.
 *
 * `attempts` counts total tries, not retries. Non-retryable errors (bad key,
 * 404, paywall-empty) throw on the first attempt without burning backoff
 * time — there is nothing to wait for.
 */
export async function scrapeUrl(
  url: string,
  attempts = 4,
  onRetry?: (attempt: number, waitMs: number, reason: string) => void,
): Promise<ScrapeResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await scrapeOnce(url);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof FirecrawlError
        ? err.retryable
        // A timeout or a socket error is not a FirecrawlError but is exactly
        // the kind of thing a retry fixes.
        : true;
      if (!retryable || attempt === attempts) break;

      // Prefer the server's own number over our guess, plus a second of
      // slack so we do not land exactly on the boundary and 429 again.
      const stated = err instanceof FirecrawlError ? err.retryAfterMs : null;
      const waitMs = stated !== null
        ? stated + 1000
        : 3000 * Math.pow(2, attempt - 1);

      onRetry?.(
        attempt,
        waitMs,
        lastError instanceof Error ? lastError.message : String(lastError),
      );
      await delay(waitMs);
    }
  }
  throw lastError;
}
