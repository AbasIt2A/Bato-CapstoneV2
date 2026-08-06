// Unit tests for the approved-source whitelist (contract: sources.ts).
// Pure, offline, synchronous. Run with:
//   deno test --allow-read --allow-env tests/sources_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  APPROVED_SOURCE_IDS,
  isApprovedSource,
} from "../supabase/functions/_shared/sources.ts";

/**
 * Exactly the IDs admitted under the inclusion framework — order-insensitive.
 * Must stay in sync with the knowledge_sources register (see
 * supabase/migrations/20260806000001_source_register_and_scopes.sql and
 * 20260806000002_register_psa_source.sql). PSA was admitted 2026-08-06 as
 * the only official publisher of Philippine registered-death counts by cause.
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
  const rejected = ["NKF", "PhilHealth", "ISN", "NKDEP", "WebMD", ""];
  for (const id of rejected) {
    assertEquals(isApprovedSource(id), false, id === "" ? "(empty string)" : id);
  }
});
