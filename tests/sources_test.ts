// Unit tests for the approved-source whitelist (contract: sources.ts).
// Pure, offline, synchronous. Run with:
//   deno test --allow-read --allow-env tests/sources_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  APPROVED_SOURCE_IDS,
  isApprovedSource,
  SOURCE_CATEGORIES,
  SOURCE_DISPLAY_NAMES,
} from "../supabase/functions/_shared/sources.ts";

/**
 * Exactly the IDs admitted under the inclusion framework — order-insensitive.
 * Must stay in sync with the knowledge_sources register:
 *   20260806000001_source_register_and_scopes.sql  — the original eight
 *   20260806000002_register_psa_source.sql         — PSA, the only official
 *                                                    publisher of Philippine
 *                                                    registered-death counts
 *   20260810000001_register_top20_sources.sql      — the nine publishers
 *                                                    behind SOURCES.md,
 *                                                    approved 2026-08-10
 */
const EXPECTED_IDS = [
  "DOH",
  "PSN",
  "WHO",
  "CDC",
  "NIDDK",
  "KDIGO",
  "AstraZeneca",
  "SCORED",
  "PSA",
  // Admitted 2026-08-10 with the Top 20 source list.
  //
  // PHCOI and GBD were admitted alongside these and removed from the register
  // on 2026-08-11: neither source can be fetched, so neither will ever have a
  // chunk to attribute. Seven of the nine remain.
  "PHESRD",
  "PSH",
  "CHEN2019",
  "NICE",
  "KDOQI",
  "ISN",
  "APSN",
];

Deno.test("APPROVED_SOURCE_IDS: exactly the approved set, order-insensitive", () => {
  const actualSorted = [...APPROVED_SOURCE_IDS].sort();
  const expectedSorted = [...EXPECTED_IDS].sort();
  assertEquals(actualSorted, expectedSorted);
});

Deno.test("APPROVED_SOURCE_IDS: no duplicates", () => {
  assertEquals(APPROVED_SOURCE_IDS.length, new Set(APPROVED_SOURCE_IDS).size);
});

Deno.test("isApprovedSource: true for every approved source", () => {
  for (const id of EXPECTED_IDS) {
    assertEquals(isApprovedSource(id), true, id);
  }
});

Deno.test("isApprovedSource: false for pending or unapproved sources", () => {
  // ISN used to sit on this list and was admitted on 2026-08-10 — the reason
  // this test is written against a literal list rather than a negation of
  // APPROVED_SOURCE_IDS, which would have passed silently either way.
  const rejected = [
    "NKF",
    "PhilHealth",
    "NKDEP",
    "WebMD",
    "UNREGISTERED", // the cleaner's placeholder for an unregistered publisher
    "",
  ];
  for (const id of rejected) {
    assertEquals(isApprovedSource(id), false, id === "" ? "(empty string)" : id);
  }
});

Deno.test("isApprovedSource: PSH and PSN are distinct sources", () => {
  // Adjacent acronyms, different bodies: Hypertension vs Nephrology. A
  // cross-attributed blood-pressure figure is a provenance error no
  // downstream layer can detect, so pin both.
  assertEquals(isApprovedSource("PSH"), true);
  assertEquals(isApprovedSource("PSN"), true);
  assertEquals(SOURCE_DISPLAY_NAMES["PSH"], "Philippine Society of Hypertension");
  assertEquals(SOURCE_DISPLAY_NAMES["PSN"], "Philippine Society of Nephrology");
});

Deno.test("every approved source has a display name and a valid category", () => {
  const categories = new Set([
    "official_health_body",
    "clinical_guideline",
    "peer_reviewed",
  ]);
  for (const id of APPROVED_SOURCE_IDS) {
    const name = SOURCE_DISPLAY_NAMES[id];
    assertEquals(
      typeof name === "string" && name.length > 0,
      true,
      `${id} has no display name — citations would render a bare ID`,
    );
    assertEquals(
      categories.has(SOURCE_CATEGORIES[id]),
      true,
      `${id} has invalid category ${SOURCE_CATEGORIES[id]}`,
    );
  }
});
