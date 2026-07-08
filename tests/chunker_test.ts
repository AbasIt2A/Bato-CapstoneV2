// Markdown-chunker tests (contract: scripts/chunker.ts). Pure, offline,
// synchronous — fixtures are built inline, nothing is read from disk.
//
// Run with: deno test --allow-read --allow-env tests/chunker_test.ts

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { chunkMarkdownDocument } from "../scripts/chunker.ts";

// ---------------------------------------------------------------------------
// Fixture: a normal, valid document — two short H2 sections, no H3s. One of
// the sections carries a staging table that must stay intact in one chunk.
// ---------------------------------------------------------------------------

const VALID_DOC = `---
source: NIDDK
title: CKD Basics
approved: true
last_updated: 2026-07-07
topic_tags: [basics, symptoms]
---

# CKD Basics

## What is chronic kidney disease?

Chronic kidney disease (CKD) means the kidneys are damaged and can't filter
blood the way they should.

## Stages of CKD

CKD has five stages based on how well the kidneys filter blood.

| Stage | eGFR range | Description |
|---|---|---|
| 1 | 90+ | Normal or high, with other signs of kidney damage |
| 2 | 60-89 | Mild loss of function |
| 3a | 45-59 | Mild to moderate loss |
| 3b | 30-44 | Moderate to severe loss |
| 4 | 15-29 | Severe loss of function |
| 5 | <15 | Kidney failure |
`;

Deno.test("chunkMarkdownDocument: valid doc chunks per H2 with correct heading_path breadcrumbs", () => {
  const chunks = chunkMarkdownDocument(VALID_DOC);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].source, "NIDDK");
  assertEquals(chunks[0].title, "CKD Basics");
  assertEquals(chunks[0].heading_path, "CKD Basics > What is chronic kidney disease?");
  assertEquals(chunks[1].heading_path, "CKD Basics > Stages of CKD");
});

Deno.test("chunkMarkdownDocument: a staging table stays intact in one chunk", () => {
  const chunks = chunkMarkdownDocument(VALID_DOC);
  const stagesChunk = chunks.find((c) => c.heading_path.includes("Stages of CKD"));
  assertEquals(stagesChunk !== undefined, true, "expected a chunk for 'Stages of CKD'");
  assertEquals(stagesChunk!.content.includes("| 1 | 90+"), true);
  assertEquals(stagesChunk!.content.includes("| 3a | 45-59"), true);
  assertEquals(stagesChunk!.content.includes("| 5 | <15"), true);
});

Deno.test("chunkMarkdownDocument: topic_tags from front-matter are carried through to every chunk", () => {
  const chunks = chunkMarkdownDocument(VALID_DOC);
  for (const c of chunks) {
    assertEquals(c.topic_tags.includes("basics"), true);
    assertEquals(c.topic_tags.includes("symptoms"), true);
  }
});

// ---------------------------------------------------------------------------
// Fixture: short H3 subsections under one H2 — must stay merged with the
// parent (heading_path stops at the H2, no H3 split).
// ---------------------------------------------------------------------------

const SHORT_H3_DOC = `---
source: NIDDK
title: CKD Basics
approved: true
last_updated: 2026-07-07
---

# CKD Basics

## Symptoms of CKD

Short intro.

### Early symptoms

Often none at all.

### Later symptoms

Swelling, fatigue, and nausea.
`;

Deno.test("chunkMarkdownDocument: short H3 subsections stay merged with the parent H2", () => {
  const chunks = chunkMarkdownDocument(SHORT_H3_DOC);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].heading_path, "CKD Basics > Symptoms of CKD");
  assertEquals(chunks[0].content.includes("Early symptoms"), true);
  assertEquals(chunks[0].content.includes("Later symptoms"), true);
});

// ---------------------------------------------------------------------------
// Fixture: a long H2 (> ~2500 chars) with two H3 subsections — must split at
// the H3 boundary, each becoming its own chunk with a 3-level heading_path.
// ---------------------------------------------------------------------------

const FILLER = "Lorem ipsum dolor sit amet consectetur adipiscing elit nunc viverra. ";

const LONG_H3_DOC = `---
source: KDIGO
title: Living with CKD
approved: true
last_updated: 2026-07-07
---

# Living with CKD

## Managing daily life with CKD

Intro sentence for this section.

### Diet and nutrition

DIETMARKER ${FILLER.repeat(40)}

### Physical activity

ACTIVITYMARKER ${FILLER.repeat(40)}
`;

Deno.test("chunkMarkdownDocument: an H2 section over ~2500 chars splits at H3 boundaries", () => {
  const chunks = chunkMarkdownDocument(LONG_H3_DOC);
  const dietChunk = chunks.find((c) => c.content.includes("DIETMARKER"));
  const activityChunk = chunks.find((c) => c.content.includes("ACTIVITYMARKER"));
  assertEquals(dietChunk !== undefined, true, "expected a separate chunk for 'Diet and nutrition'");
  assertEquals(activityChunk !== undefined, true, "expected a separate chunk for 'Physical activity'");
  assertEquals(dietChunk !== activityChunk, true, "the two H3 sections must not be merged into one chunk");
  assertEquals(dietChunk!.content.includes("ACTIVITYMARKER"), false);
  assertEquals(activityChunk!.content.includes("DIETMARKER"), false);
  assertEquals(
    dietChunk!.heading_path,
    "Living with CKD > Managing daily life with CKD > Diet and nutrition",
  );
  assertEquals(
    activityChunk!.heading_path,
    "Living with CKD > Managing daily life with CKD > Physical activity",
  );
});

// ---------------------------------------------------------------------------
// Front-matter validation failures
// ---------------------------------------------------------------------------

const UNAPPROVED_FLAG_DOC = `---
source: NIDDK
title: Draft notes
approved: false
last_updated: 2026-07-07
---

# Draft notes

## Section

Some content.
`;

Deno.test("chunkMarkdownDocument: approved !== true throws", () => {
  assertThrows(() => chunkMarkdownDocument(UNAPPROVED_FLAG_DOC));
});

const UNAPPROVED_SOURCE_DOC = `---
source: WebMD
title: Some article
approved: true
last_updated: 2026-07-07
---

# Some article

## Section

Some content.
`;

Deno.test("chunkMarkdownDocument: a source not in the approved 8 throws", () => {
  assertThrows(() => chunkMarkdownDocument(UNAPPROVED_SOURCE_DOC));
});

const NO_SOURCE_DOC = `---
title: Missing source
approved: true
last_updated: 2026-07-07
---

# Missing source

## Section

Some content.
`;

Deno.test("chunkMarkdownDocument: front-matter without a source throws", () => {
  assertThrows(() => chunkMarkdownDocument(NO_SOURCE_DOC));
});
