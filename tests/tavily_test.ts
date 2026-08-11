// Tavily fallback client tests (contract: scripts/scrape/tavily.ts).
//
// Offline: only the pure data-URI stripping is exercised. No network call and
// no TAVILY_API_KEY read happens here — the module reads the key lazily,
// inside the request path, matching firecrawl.ts.
//
// Run with: deno test --allow-read --allow-env tests/tavily_test.ts

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { stripDataUris } from "../scripts/scrape/tavily.ts";

// Abbreviated from a real Tavily extract of the NIDDK CKD landing page, where
// the US flag and NIH seal arrived as multi-kilobyte base64 payloads.
const REAL_DATA_URI_IMAGE =
  "![U.S. flag](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAALCAMAAABBPP0L)";

Deno.test("stripDataUris: drops the base64 payload but keeps alt text", () => {
  const out = stripDataUris(REAL_DATA_URI_IMAGE);
  assertEquals(out, "![U.S. flag]()");
});

Deno.test("stripDataUris: removes an image with no alt text entirely", () => {
  assertEquals(stripDataUris("before ![](data:image/png;base64,AAAA) after"), "before  after");
});

Deno.test("stripDataUris: leaves ordinary image links untouched", () => {
  const markdown = "![staging chart](https://example.org/ckd-stages.png)";
  assertEquals(stripDataUris(markdown), markdown);
});

Deno.test("stripDataUris: preserves surrounding prose", () => {
  const out = stripDataUris(
    `# Chronic Kidney Disease\n\n${REAL_DATA_URI_IMAGE}\n\neGFR below 60 for three months.`,
  );
  assertStringIncludes(out, "# Chronic Kidney Disease");
  assertStringIncludes(out, "eGFR below 60 for three months.");
  assertEquals(out.includes("base64"), false);
});

Deno.test("stripDataUris: handles a bare data: link that is not an image", () => {
  assertEquals(stripDataUris("[cert](data:text/plain;base64,QUJD)"), "[cert]()");
});
