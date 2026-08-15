// Attribution tests (contract: citations.ts). Pure, offline, synchronous.
//
// These pin the deal the general chatbot now makes: the model still declares
// every source it used, but on a machine-readable line the user never sees,
// so the prose can read like an answer instead of a bibliography.
//
// Run with: deno test --allow-read --allow-env tests/citations_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  allowedCitationIds,
  mentionsSourceId,
  SOURCE_FOOTER_LABEL,
  splitSourceFooter,
  stripInlineCitations,
} from "../supabase/functions/_shared/citations.ts";
import type { RerankedChunk } from "../supabase/functions/_shared/rerank.ts";

function chunk(source: string, content: string): RerankedChunk {
  return {
    id: crypto.randomUUID(),
    source,
    title: "Diet and Lifestyle with CKD",
    content,
    topic_tags: [],
    similarity: 0.8,
    heading_path: "Diet and Lifestyle with CKD > Body weight",
    scopes: ["general_education"],
  };
}

// ---------------------------------------------------------------------------
// mentionsSourceId
// ---------------------------------------------------------------------------

Deno.test("mentionsSourceId: matches a standalone ID, not a substring or lowercase word", () => {
  assertEquals(mentionsSourceId("keep a healthy weight (NIDDK)", "NIDDK"), true);
  assertEquals(mentionsSourceId("obesity and progression (APSN, 2025)", "APSN"), true);
  // The pronoun trap the guard's own citation check had to solve.
  assertEquals(mentionsSourceId("I'm not sure who told you that", "WHO"), false);
  // Apostrophes count as part of the token, so ISN is not found in "isn't".
  assertEquals(mentionsSourceId("that isn't right", "ISN"), false);
  assertEquals(mentionsSourceId("NIDDKX is not a source", "NIDDK"), false);
});

// ---------------------------------------------------------------------------
// allowedCitationIds
// ---------------------------------------------------------------------------

Deno.test("allowedCitationIds: includes chunk sources AND bodies credited inside the text", () => {
  const chunks = [
    chunk(
      "NIDDK",
      "Obesity is associated with faster progression toward kidney failure (APSN, 2025). Weight goals on dialysis are set by the care team (KDOQI, 2020).",
    ),
    chunk("CDC", "Obesity raises the risk of chronic kidney disease."),
  ];
  const allowed = allowedCitationIds(chunks).sort();
  assertEquals(allowed, ["APSN", "CDC", "KDOQI", "NIDDK"]);
});

Deno.test("allowedCitationIds: never admits an unregistered body", () => {
  const allowed = allowedCitationIds([
    chunk("NIDDK", "A claim attributed to HealthLine and WebMD."),
  ]);
  assertEquals(allowed, ["NIDDK"]);
});

// ---------------------------------------------------------------------------
// splitSourceFooter
// ---------------------------------------------------------------------------

Deno.test("splitSourceFooter: separates prose from the declared sources", () => {
  const draft =
    `Extra weight raises the risk of kidney disease.\n${SOURCE_FOOTER_LABEL} NIDDK, CDC`;
  const split = splitSourceFooter(draft);
  assertEquals(split.hasFooter, true);
  assertEquals(split.declared, ["NIDDK", "CDC"]);
  assertEquals(split.visible, "Extra weight raises the risk of kidney disease.");
});

Deno.test("splitSourceFooter: tolerates the shapes models actually emit", () => {
  const variants = [
    "Answer text.\nSources: NIDDK; CDC",
    "Answer text.\n- SOURCES: NIDDK and CDC",
    "Answer text.\n**Sources:** NIDDK, CDC.",
    "Answer text.\nSOURCES: NIDDK, CDC\n\n",
  ];
  for (const draft of variants) {
    const split = splitSourceFooter(draft);
    assertEquals(split.declared, ["NIDDK", "CDC"], `failed on: ${draft}`);
    assertEquals(split.visible, "Answer text.", `failed on: ${draft}`);
  }
});

Deno.test("splitSourceFooter: only the LAST line counts as the declaration", () => {
  // A mid-answer mention must not be mistaken for the footer, or a reply
  // could 'declare' a source it never used.
  const draft = "Sources: this word appears mid-answer.\nThe real answer here.";
  const split = splitSourceFooter(draft);
  assertEquals(split.hasFooter, false);
  assertEquals(split.declared, []);
  assertEquals(split.visible, draft);
});

Deno.test("splitSourceFooter: a missing footer is reported, not invented", () => {
  const split = splitSourceFooter("Just an answer with no declaration.");
  assertEquals(split.hasFooter, false);
  assertEquals(split.declared, []);
});

// ---------------------------------------------------------------------------
// stripInlineCitations
// ---------------------------------------------------------------------------

Deno.test("stripInlineCitations: removes (Source: X) and bare ID parentheticals", () => {
  assertEquals(
    stripInlineCitations(
      "Extra weight raises your risk (Source: CDC). Obesity speeds progression (APSN, 2025).",
    ),
    "Extra weight raises your risk. Obesity speeds progression.",
  );
});

Deno.test("stripInlineCitations: removes an 'According to X,' opener and recapitalizes", () => {
  assertEquals(
    stripInlineCitations(
      "According to NIDDK, there is no single healthy weight for everyone.",
    ),
    "There is no single healthy weight for everyone.",
  );
  assertEquals(
    stripInlineCitations(
      "According to the Centers for Disease Control and Prevention, obesity raises the risk.",
    ),
    "Obesity raises the risk.",
  );
});

Deno.test("stripInlineCitations: leaves ordinary prose and non-citation parentheses alone", () => {
  const plain =
    "As kidneys fail, waste builds up in the blood. Protein in the urine (a sign of damage) matters.";
  assertEquals(stripInlineCitations(plain), plain);

  // "According to your doctor" is not an attribution to a registered source.
  const doctor = "According to your doctor, you may need a different plan.";
  assertEquals(stripInlineCitations(doctor), doctor);
});

Deno.test("stripInlineCitations: a reply that was already clean is unchanged", () => {
  const clean =
    "Carrying extra weight makes diabetes and high blood pressure more likely, and both damage the kidneys over time.";
  assertEquals(stripInlineCitations(clean), clean);
});
