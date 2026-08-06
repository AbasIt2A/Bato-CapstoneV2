// Unit tests for the approved-source whitelist (contract: sources.ts).
// Pure, offline, synchronous. Run with:
//   deno test --allow-read --allow-env tests/sources_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  APPROVED_SOURCE_IDS,
  isApprovedSource,
} from "../supabase/functions/_shared/sources.ts";

/** Exactly the 9 IDs the contract names — order-insensitive. */
const EXPECTED_IDS = [
  "DOH",
  "PSN",
  // Admitted 2026-08-06 to unblock Philippine mortality statistics.
  "PSA",
  "WHO",
  "CDC",
  "NIDDK",
  "KDIGO",
  "AstraZeneca",
  "SCORED",
];

Deno.test("APPROVED_SOURCE_IDS: exactly the approved 9, order-insensitive", () => {
  const actualSorted = [...APPROVED_SOURCE_IDS].sort();
  const expectedSorted = [...EXPECTED_IDS].sort();
  assertEquals(actualSorted, expectedSorted);
});

Deno.test("APPROVED_SOURCE_IDS: no duplicates", () => {
  assertEquals(APPROVED_SOURCE_IDS.length, new Set(APPROVED_SOURCE_IDS).size);
});

Deno.test("isApprovedSource: true for every one of the approved 9", () => {
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
