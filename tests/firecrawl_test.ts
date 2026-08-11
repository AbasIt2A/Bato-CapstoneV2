// Firecrawl client tests (contract: scripts/scrape/firecrawl.ts).
//
// Offline: only the pure Retry-After parsing is exercised. No network call and
// no FIRECRAWL_API_KEY read happens here — the module reads the key lazily,
// inside the request path, precisely so importing it in a test costs nothing.
//
// Run with: deno test --allow-read --allow-env tests/firecrawl_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import { retryAfterMs } from "../scripts/scrape/firecrawl.ts";

function response(headers: Record<string, string> = {}): Response {
  return new Response("", { status: 429, headers });
}

// The literal body Firecrawl returned when the first full run blew the rate
// limit. Blind 2s/4s backoffs against this 18-second window burned both
// retries and dropped three sources, so the number has to be read, not guessed.
const REAL_429_BODY =
  '{"success":false,"error":"Rate limit exceeded. Consumed (req/min): 13, ' +
  "Remaining (req/min): 0. Upgrade your plan at https://firecrawl.dev/pricing " +
  'for increased rate limits or please retry after 18s, resets at Sun Aug 09 2026 17:29:13 GMT+0000"}';

Deno.test("retryAfterMs: reads the delay stated in Firecrawl's error body", () => {
  assertEquals(retryAfterMs(response(), REAL_429_BODY), 18000);
});

Deno.test("retryAfterMs: prefers the Retry-After header when present", () => {
  assertEquals(
    retryAfterMs(response({ "retry-after": "30" }), REAL_429_BODY),
    30000,
  );
});

Deno.test("retryAfterMs: accepts an HTTP-date Retry-After", () => {
  const when = new Date(Date.now() + 20_000).toUTCString();
  const ms = retryAfterMs(response({ "retry-after": when }), "");
  // Second-resolution date, so allow a little slack either side.
  assertEquals(ms !== null && ms > 17_000 && ms <= 21_000, true, `got ${ms}`);
});

Deno.test("retryAfterMs: null when the server states nothing", () => {
  assertEquals(retryAfterMs(response(), '{"error":"something else"}'), null);
});

Deno.test("retryAfterMs: handles a fractional stated delay", () => {
  assertEquals(retryAfterMs(response(), "please retry after 2.5s"), 2500);
});
