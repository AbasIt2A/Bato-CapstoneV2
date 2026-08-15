// Source-chip link tests (contract: frontend/src/lib/source-links.ts).
// Pure, offline, synchronous. No network — a URL's reachability is a fact
// about the internet on the day it is checked, not something a unit test can
// pin; what IS pinnable is that the table stays in step with the register.
//
// Run with: deno test --allow-read --allow-env tests/source_links_test.ts
//
// The table is deliberately a second mirror of the register (the frontend
// cannot import Deno modules from supabase/functions/), so these tests are
// the mechanism that stops the two drifting: a source admitted to
// _shared/sources.ts without a line here would render as a dead chip, and a
// display name edited on one side only would put two different publisher
// names in front of the user for one ID.

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  APPROVED_SOURCE_IDS,
  SOURCE_DISPLAY_NAMES,
} from "../supabase/functions/_shared/sources.ts";
import {
  linkHost,
  SOURCE_REFERENCES,
  sourceReference,
} from "../frontend/src/lib/source-links.ts";

Deno.test("every approved source has a reference entry", () => {
  for (const id of APPROVED_SOURCE_IDS) {
    assertEquals(
      typeof SOURCE_REFERENCES[id],
      "object",
      `${id} is on the register with no entry in source-links.ts — its chip ` +
        `would render unlinked with no tooltip name`,
    );
  }
});

Deno.test("no reference entry for an unregistered source", () => {
  // The other direction: an ID here that the register does not know can never
  // appear on a chip (citations.ts filters against APPROVED_SOURCE_IDS), so
  // it is dead weight that outlived a source's removal — PHCOI and GBD were
  // both registered and then removed.
  for (const id of Object.keys(SOURCE_REFERENCES)) {
    assertEquals(
      APPROVED_SOURCE_IDS.includes(id),
      true,
      `${id} has a link entry but is not on the approved register`,
    );
  }
});

Deno.test("reference names match the register exactly", () => {
  for (const id of APPROVED_SOURCE_IDS) {
    assertEquals(
      SOURCE_REFERENCES[id].name,
      SOURCE_DISPLAY_NAMES[id],
      `${id}'s name has drifted from the register`,
    );
  }
});

Deno.test("every URL is an absolute https URL", () => {
  for (const [id, ref] of Object.entries(SOURCE_REFERENCES)) {
    if (!ref.url) continue;
    assertMatch(ref.url, /^https:\/\//, `${id} must link over https`);
    // Parses, and to the host the entry claims — a typo'd scheme or a
    // stray space would otherwise reach the DOM as a broken href.
    assertEquals(new URL(ref.url).protocol, "https:", id);
  }
});

Deno.test("AstraZeneca has no URL, on purpose", () => {
  // Its contribution is the licensed printed SCORED patient card, which has
  // no public page. This asserts the ABSENCE so that a later well-meaning
  // edit pointing it at the corporate site fails loudly: that site is not
  // the source the corpus cites.
  assertEquals(SOURCE_REFERENCES["AstraZeneca"].url, undefined);
  assertEquals(typeof SOURCE_REFERENCES["AstraZeneca"].name, "string");
});

Deno.test("PSH and PSN link to different bodies", () => {
  // Adjacent acronyms, different societies (Hypertension vs Nephrology). A
  // reader sent to the wrong one has been misinformed about provenance, and
  // nothing downstream would catch it.
  const psh = SOURCE_REFERENCES["PSH"].url!;
  const psn = SOURCE_REFERENCES["PSN"].url!;
  assertEquals(psh === psn, false);
  assertEquals(linkHost(psn), "psn.org.ph");
  assertEquals(linkHost(psh), "philippinesocietyofhypertension.org.ph");
});

Deno.test("no two sources share a URL", () => {
  const seen = new Map<string, string>();
  for (const [id, ref] of Object.entries(SOURCE_REFERENCES)) {
    if (!ref.url) continue;
    const owner = seen.get(ref.url);
    assertEquals(
      owner,
      undefined,
      `${id} and ${owner} link to the same page — one of them is attributed ` +
        `to the wrong publisher`,
    );
    seen.set(ref.url, id);
  }
});

Deno.test("sourceReference: known ID resolves, unknown ID is undefined", () => {
  assertEquals(sourceReference("NIDDK")?.name, SOURCE_DISPLAY_NAMES["NIDDK"]);
  assertEquals(sourceReference("WebMD"), undefined);
  assertEquals(sourceReference(""), undefined);
});

Deno.test("linkHost: strips www, degrades to the input on junk", () => {
  assertEquals(linkHost("https://www.cdc.gov/kidney-disease/index.html"), "cdc.gov");
  assertEquals(linkHost("https://psn.org.ph/"), "psn.org.ph");
  assertEquals(linkHost("not a url"), "not a url");
});
