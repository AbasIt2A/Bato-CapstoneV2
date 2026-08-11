// Scraped-source cleaner tests (contract: scripts/scrape/cleaner.ts). Pure,
// offline, synchronous — fixtures are built inline, nothing is read from disk
// and no network or API key is involved.
//
// Run with: deno test --allow-read --allow-env tests/cleaner_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildFrontMatter,
  cleanDocument,
  type CleanOptions,
  UNREGISTERED_SOURCE,
} from "../scripts/scrape/cleaner.ts";
import { chunkMarkdownDocument } from "../scripts/chunker.ts";
import { MANIFEST } from "../scripts/scrape/manifest.ts";
import { isApprovedSource } from "../supabase/functions/_shared/sources.ts";
import { isRetrievalScope } from "../supabase/functions/_shared/scopes.ts";

function options(overrides: Partial<CleanOptions> = {}): CleanOptions {
  return {
    kind: "web",
    title: "Test Document",
    sourceId: "NIDDK",
    scopes: ["general_education"],
    topicTags: ["ckd", "basics"],
    url: "https://example.org/doc",
    retrievedOn: "2026-08-10",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Character normalisation
// ---------------------------------------------------------------------------

Deno.test("cleaner: repairs PDF ligatures and smart punctuation", () => {
  const raw = "# T\n\n## S\n\nThe kidneys ﬁlter blood and aﬀect ﬂuid balance — it’s “normal”.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "filter blood");
  assertStringIncludes(body, "affect");
  assertStringIncludes(body, "fluid balance");
  assertStringIncludes(body, "it's");
  assertStringIncludes(body, '"normal"');
});

Deno.test("cleaner: preserves the m² in the eGFR unit", () => {
  // NFKC normalisation would rewrite this to "m2". The eGFR unit is the most
  // load-bearing string in the corpus; if this test fails, someone reached
  // for .normalize() and silently changed a clinical unit.
  const raw = "# T\n\n## S\n\neGFR is reported in mL/min/1.73 m².";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "mL/min/1.73 m²");
});

Deno.test("cleaner: keeps numeric ranges intact when converting en dashes", () => {
  const raw = "# T\n\n## S\n\nStage 3a covers an eGFR of 45–59.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "45-59");
});

// ---------------------------------------------------------------------------
// PDF repair
// ---------------------------------------------------------------------------

Deno.test("cleaner: rejoins hyphen-split words across line breaks", () => {
  const raw = "# T\n\n## S\n\nDamage to the kid-\nney reduces filtra-\ntion over time.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "kidney");
  assertStringIncludes(body, "filtration");
  assert(!body.includes("kid-"), "hyphen split should be gone");
});

Deno.test("cleaner: leaves genuine compounds hyphenated", () => {
  // Continuation is uppercase, so this is a compound that wrapped, not a
  // split word. Joining it would produce "COVID19".
  const raw = "# T\n\n## S\n\nEvidence from COVID-\n19 studies is limited.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "COVID-");
});

Deno.test("cleaner: removes running headers repeated across pages", () => {
  const header = "KDIGO 2024 Clinical Practice Guideline";
  const raw = [
    "# Guideline",
    "## Chapter 1",
    header,
    "Real content about albuminuria.",
    "12",
    header,
    "More real content about staging.",
    "13",
    header,
    "Further content on referral.",
    "14",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!body.includes(header), "running header should be removed");
  assert(!/^\s*1[234]\s*$/m.test(body), "bare page numbers should be removed");
  assertStringIncludes(body, "albuminuria");
  assertStringIncludes(body, "staging");
});

Deno.test("cleaner: reflows hard-wrapped paragraphs without welding headings", () => {
  const raw = [
    "# Doc",
    "",
    "## Section",
    "",
    "Chronic kidney disease means the kidneys are damaged and",
    "cannot filter blood the way they should, which allows",
    "wastes to build up.",
    "",
    "## Next Section",
    "",
    "Separate paragraph.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "damaged and cannot filter blood");
  assertStringIncludes(body, "should, which allows wastes to build up.");
  // The heading must survive as its own line — this is what chunking depends on.
  assert(/^## Next Section$/m.test(body), "H2 must not be absorbed into prose");
});

Deno.test("cleaner: strips table-of-contents dot leaders", () => {
  const raw = [
    "# Guideline",
    "## Contents",
    "Chapter 1: Definition .......... 5",
    "Chapter 2: Staging ............ 17",
    "Chapter 3: Referral · · · · · 42",
    "## Chapter 1: Definition",
    "CKD is defined as abnormalities of kidney structure or function.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!/\.{3,}/.test(body), "no dot leaders should survive");
  assert(!/Chapter 2: Staging/.test(body), "TOC entry should be gone");
  // The real heading of the same name must survive — only the TOC copy goes.
  assert(/^## Chapter 1: Definition$/m.test(body));
  assertStringIncludes(body, "abnormalities of kidney structure");
});

Deno.test("cleaner: cuts the trailing reference list off a PDF", () => {
  const body = Array.from(
    { length: 120 },
    (_, i) => `Real guideline content sentence number ${i} about albuminuria.`,
  ).join("\n");
  const refs = Array.from(
    { length: 70 },
    (_, i) =>
      `${i + 1}. Bang H, Vupputuri S, Shoham DA, et al. A study title here. Arch Intern Med. 2007;${i}:1-10.`,
  ).join("\n");
  const raw = [
    "# Guideline",
    "## Chapter 1",
    body,
    "## References",
    refs,
    "1. Bang H, Vupputuri S, Shoham DA, et al. SCORED. Arch Intern Med. 2007.",
    "2. Levey AS, Coresh J. Chronic kidney disease. Lancet. 2012;379:165-180.",
  ].join("\n");
  const result = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!/Bang H, Vupputuri/.test(result.body), "references should be cut");
  assert(!/Levey AS/.test(result.body), "references should be cut");
  assertStringIncludes(result.body, "albuminuria");
  const effect = result.report.effects.find((e) =>
    e.rule === "strip-trailing-apparatus"
  );
  assert(effect !== undefined, "the cut must be reported");
  assert(
    effect.samples.some((s) => s.includes("trailing apparatus")),
    "the report must say how much was cut",
  );
});

Deno.test("cleaner: an early 'References' mention cannot truncate the document", () => {
  // The position guard: a marker in the first 60% is not the apparatus.
  const tail = Array.from(
    { length: 40 },
    (_, i) => `Substantive clinical content line ${i} about eGFR thresholds.`,
  ).join("\n");
  const raw = ["# Doc", "## References", "See below.", "## Body", tail].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "eGFR thresholds");
  assertStringIncludes(body, "Substantive clinical content line 39");
});

Deno.test("cleaner: a sentence mentioning references is not a cut marker", () => {
  const tail = Array.from(
    { length: 30 },
    (_, i) => `Clinical guidance line ${i} on blood pressure targets.`,
  ).join("\n");
  const raw = [
    "# Doc",
    "## Section",
    tail,
    "Clinicians should consult the references listed by their local formulary.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "consult the references listed");
});

Deno.test("cleaner: a SHORT web reference section is kept", () => {
  // The cut is gated on size, not format. A short reference list at the foot
  // of a health-agency page is content, not apparatus.
  const tail = Array.from(
    { length: 40 },
    (_, i) => `Web article content line ${i}.`,
  ).join("\n");
  const raw = ["# Doc", "## Body", tail, "## References", "Some citation."].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "web" }));
  assertStringIncludes(body, "References");
});

Deno.test("cleaner: a LARGE web reference section is cut", () => {
  // Regression: the two largest chunks in the whole corpus were the reference
  // lists of the APSN (79,600 chars) and Chen (34,787) journal articles, both
  // fetched as HTML — the rule used to be gated to PDFs and never saw them.
  const body = Array.from(
    { length: 240 },
    (_, i) => `Substantive article content about kidney disease, line ${i}.`,
  ).join("\n");
  const refs = Array.from(
    { length: 120 },
    (_, i) => `${i}. Author AB, Other CD, et al. A paper title. Journal. 2019;${i}:1-10.`,
  ).join("\n");
  const raw = ["# Doc", "## Body", body, "## References", refs].join("\n");
  const result = cleanDocument(raw, options({ kind: "web" }));
  assert(!/Author AB/.test(result.body), "large reference list should be cut");
  assertStringIncludes(result.body, "Substantive article content");
});

// ---------------------------------------------------------------------------
// Oversized-section splitting
// ---------------------------------------------------------------------------

function paragraphs(n: number, label: string): string {
  return Array.from(
    { length: n },
    (_, i) =>
      `${label} paragraph ${i}. ` +
      "Clinical guidance text about kidney function and albuminuria that runs " +
      "to a reasonable paragraph length for testing purposes.",
  ).join("\n\n");
}

Deno.test("cleaner: subdivides an H2 section the chunker could not split", () => {
  // KDIGO's "Chapter 5" was 87,874 chars in ONE chunk: a long H2 with no H3
  // children, which chunker.ts leaves whole however large it gets.
  const raw = ["# Doc", "## Chapter 5. Optimal models of care", paragraphs(40, "Care")].join("\n\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(/\(part 1\)/.test(body), "part headings should be inserted");
  assert(/\(part 2\)/.test(body), "more than one part expected");

  const chunks = chunkMarkdownDocument(
    cleanDocument(raw, options({ kind: "pdf" })).markdown.replace(
      "approved: false",
      "approved: true",
    ),
  );
  const max = Math.max(...chunks.map((c) => c.content.length));
  assert(chunks.length > 1, `expected several chunks, got ${chunks.length}`);
  assert(max < 6000, `largest chunk still ${max} chars`);
});

Deno.test("cleaner: subdivides a root intro using H2, not H3", () => {
  // Regression: content before the first H2 was split with H3s, which
  // chunker.ts never collects up there — so the WHO resolution stayed one
  // 12,802-char chunk despite having 54 paragraphs.
  const raw = ["# WHO Resolution", paragraphs(40, "Resolution")].join("\n\n");
  const result = cleanDocument(raw, options({ kind: "pdf" }));
  assert(/^## .*\(part 1\)/m.test(result.body), "root intro must split at H2");
  const chunks = chunkMarkdownDocument(
    result.markdown.replace("approved: false", "approved: true"),
  );
  const max = Math.max(...chunks.map((c) => c.content.length));
  assert(chunks.length > 1, `expected several chunks, got ${chunks.length}`);
  assert(max < 6000, `largest chunk still ${max} chars`);
});

Deno.test("cleaner: never splits inside a table", () => {
  // A single indivisible paragraph (a wide table) is emitted whole rather
  // than cut, on the same principle chunker.ts follows for lists and tables.
  const table = ["| Stage | eGFR | Description |", "| --- | --- | --- |"]
    .concat(
      Array.from(
        { length: 90 },
        (_, i) => `| G${i} | ${90 - i} | Row ${i} describing a GFR category |`,
      ),
    ).join("\n");
  const raw = ["# Doc", "## Staging", table].join("\n\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  const rows = body.split("\n").filter((l) => l.trim().startsWith("| G")).length;
  assertEquals(rows, 90, "every table row must survive");
  assert(
    !/\(part \d\)/.test(body),
    "an indivisible table must not be subdivided",
  );
});

Deno.test("cleaner: leaves already-small sections untouched", () => {
  const raw = [
    "# Doc",
    "## Section One",
    "Short content about kidneys.",
    "## Section Two",
    "More short content.",
  ].join("\n\n");
  const { body } = cleanDocument(raw, options());
  assert(!/\(part \d\)/.test(body), "small sections need no subdivision");
  assertStringIncludes(body, "## Section One");
  assertStringIncludes(body, "## Section Two");
});

Deno.test("cleaner: strips bracketed citation markers from PDFs", () => {
  const raw = "# T\n\n## S\n\nRisk rises with age [12], especially past 60 [13,14].";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!body.includes("[12]"));
  assert(!body.includes("[13,14]"));
  assertStringIncludes(body, "past 60");
});

// ---------------------------------------------------------------------------
// Firecrawl escaping — found on the first live run of every large PDF
// ---------------------------------------------------------------------------

Deno.test("cleaner: removes Firecrawl's trailing hard-break backslashes", () => {
  // 1768 of 1778 lines in one KDIGO chapter ended in a backslash. Reflow then
  // welded them into sentences: "validated tools in\ clinical practice".
  const raw = [
    "# Doc",
    "## Section",
    "Evaluate the utility and barriers to using validated tools in\\",
    "clinical practice to assess kidney function over time.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!body.includes("\\"), `a backslash survived: ${body}`);
  assertStringIncludes(body, "validated tools in clinical practice");
});

Deno.test("cleaner: unescapes Firecrawl's escaped metacharacters", () => {
  const raw = [
    "# Doc",
    "## Section",
    "VOLUME 105 \\| ISSUE 4S \\| APRIL 2024",
    "Values of \\[<1 mg/mmol\\] were reclassified in the 2024 update.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "[<1 mg/mmol]");
  assert(!/\\\|/.test(body), "escaped pipes should be unescaped");
});

Deno.test("cleaner: escaping does not hide a running header from dedup", () => {
  // The second reason unescaping runs first: "Chapter 5. Models of care\" and
  // "Chapter 5. Models of care" are different strings, so the repeated-line
  // detector counted them separately and removed neither.
  const header = "KDIGO 2024 Clinical Practice Guideline";
  const raw = [
    "# Doc",
    "## Section",
    `${header}\\`,
    "Real content about albuminuria thresholds.",
    header,
    "More real content about staging categories.",
    `${header}\\`,
    "Further content on specialist referral.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!body.includes(header), `running header survived:\n${body}`);
  assertStringIncludes(body, "albuminuria thresholds");
});

// ---------------------------------------------------------------------------
// LaTeX math from PDF extraction — the eGFR unit and the word "CKD"
// ---------------------------------------------------------------------------

Deno.test("cleaner: restores the eGFR unit from LaTeX", () => {
  // Firecrawl returned "1.73 m²" as "1. 7 3 \mathrm {m} ^ {2}" 81 times in
  // the KDIGO guideline. This is the definitional unit of the whole corpus.
  const raw = "# T\n\n## S\n\neGFR below 60 ml/min per 1. 7 3 \\mathrm {m} ^ {2} indicates CKD.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "1.73 m²");
  assert(!/mathrm/.test(body), "no LaTeX command should survive");
});

Deno.test("cleaner: un-letter-spaces \\mathrm acronyms", () => {
  // "CKD" arrived as "\mathrm {C K D}" — letter-spaced into something no
  // embedding would ever match against a user's question.
  const raw = "# T\n\n## S\n\nChronic kidney disease (\\mathrm {C K D}) is progressive.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "(CKD)");
});

Deno.test("cleaner: handles both single- and double-escaped LaTeX", () => {
  // Firecrawl escapes the command's own backslash in some documents.
  const single = cleanDocument(
    "# T\n\n## S\n\nArea of 1. 7 3 \\mathrm {m} ^ {2} here.",
    options({ kind: "pdf" }),
  );
  const double = cleanDocument(
    "# T\n\n## S\n\nArea of 1. 7 3 \\\\mathrm {m} ^ {2} here.",
    options({ kind: "pdf" }),
  );
  assertStringIncludes(single.body, "1.73 m²");
  assertStringIncludes(double.body, "1.73 m²");
});

Deno.test("cleaner: converts the LaTeX symbols that appear in clinical text", () => {
  const raw = "# T\n\n## S\n\nStore at 4^\\circ C with \\mu mol/l and values \\le 60 or \\ge 90.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "°");
  assertStringIncludes(body, "µ");
  assertStringIncludes(body, "≤");
  assertStringIncludes(body, "≥");
});

Deno.test("cleaner: converts LaTeX comparators followed directly by a number", () => {
  // Regression: these patterns used \b, but in "\geq30" the position after
  // "geq" sits between two word characters, so \b never matched and the
  // command survived. This is the COMMON form in the KDOQI guideline, not an
  // edge case — "\geq30", "\leq0.001", "\pm4.5" all appear that way.
  const raw = "# T\n\n## S\n\nBMI \\geq30 kg/m2, P\\leq0.001, and 24.4\\pm4.5 kg/m2 observed.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "≥30");
  assertStringIncludes(body, "≤0.001");
  assertStringIncludes(body, "±4.5");
  assert(!/\\/.test(body), `backslash survived: ${body}`);
});

Deno.test("cleaner: strips the long tail of unknown LaTeX commands", () => {
  const raw = "# T\n\n## S\n\nValues \\mathtt{ABC} and \\mathbb{R} and \\textcircled{c} and \\overline{x} here.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!/\\/.test(body), `backslash survived: ${body}`);
  assertStringIncludes(body, "ABC");
});

Deno.test("cleaner: leaves braces alone in a document with no LaTeX", () => {
  // The brace sweep is guarded on the document actually having contained
  // LaTeX, so ordinary text keeping braces is untouched.
  const raw = "# T\n\n## S\n\nThe config value {threshold} is set by the clinician.";
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "{threshold}");
});

Deno.test("cleaner: spaced-decimal repair never touches a real number row", () => {
  // The anchor is the whole safety argument: without a following unit, a
  // genuine data row must be left exactly as it is.
  const raw = "# T\n\n## S\n\nObserved values were 9.1 9.0 9.6 13 14 across the cohort.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "9.1 9.0 9.6 13 14");
});

Deno.test("cleaner: spaced-decimal repair works across the common units", () => {
  const raw = "# T\n\n## S\n\nDoses of 2. 5 mg and 1. 2 5 mmol and 8. 4 % were recorded.";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "2.5 mg");
  assertStringIncludes(body, "1.25 mmol");
  assertStringIncludes(body, "8.4 %");
});

Deno.test("cleaner: a URL inside parentheses does not strand its full stop", () => {
  // "…license (http://creativecommons.org/…)." stripped to "license ."
  // because empty-bracket removal ran after punctuation reattachment.
  const raw = [
    "# T",
    "## S",
    "This is an open access article under the CC BY-NC-ND license (http://creativecommons.org/licenses/by-nc-nd/4.0/).",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "CC BY-NC-ND license.");
  assert(!/ \./.test(body), `stranded full stop: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------------
// Heading inference for unstructured PDFs
// ---------------------------------------------------------------------------

Deno.test("cleaner: infers headings for a PDF with no markup at all", () => {
  // KDIGO extracted to 1.0 MB with zero '#' lines, which made the whole
  // guideline a single chunk.
  const filler = Array.from(
    { length: 30 },
    (_, i) => `Guideline prose line ${i} about kidney function assessment.`,
  ).join("\n");
  const raw = [
    "Chapter 1: Evaluation of CKD",
    filler,
    "1.2 Evaluation of GFR",
    filler,
    "CONVERSION FACTORS OF CONVENTIONAL UNITS",
    filler,
  ].join("\n");
  const { body, report } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(/^## Chapter 1: Evaluation of CKD$/m.test(body), "chapter -> H2");
  assert(/^### 1\.2 Evaluation of GFR$/m.test(body), "numbered section -> H3");
  assert(
    /^## CONVERSION FACTORS OF CONVENTIONAL UNITS$/m.test(body),
    "all-caps line -> H2",
  );
  assert(report.headings.h2 >= 2 && report.headings.h3 >= 1);
});

Deno.test("cleaner: heading inference never promotes numeric data lines", () => {
  // Every one of these opens like "N.M Title" but is data, not a heading.
  const filler = Array.from(
    { length: 30 },
    (_, i) => `Guideline prose line ${i} about measurement.`,
  ).join("\n");
  const raw = [
    "Chapter 1: Evaluation",
    filler,
    "1.73 m2 and ACR <10 mg/g were moved to a different category",
    "9.1 9.0 9.6 13 14",
    "836.3 (704.2-981.6)",
    "25.3 (22.2-28.9) million CVD DALYs were attributable to CKD",
    filler,
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!/^#{2,3} 1\.73/m.test(body), "unit value must not become a heading");
  assert(!/^#{2,3} 9\.1/m.test(body), "numeric row must not become a heading");
  assert(!/^#{2,3} 836\.3/m.test(body), "figure must not become a heading");
  assert(!/^#{2,3} 25\.3/m.test(body), "figure must not become a heading");
});

Deno.test("cleaner: heading inference leaves already-structured PDFs alone", () => {
  // NICE NG203 has a heading every ~870 chars; running inference over it
  // would fragment body text that merely looks title-shaped.
  const raw = [
    "# Guideline",
    ...Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\nSHORT CAPS LINE HERE\nBody prose for section ${i}.`),
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(
    !/^## SHORT CAPS LINE HERE$/m.test(body),
    "dense documents must not get inferred headings",
  );
});

// ---------------------------------------------------------------------------
// Unheaded bibliographies
// ---------------------------------------------------------------------------

Deno.test("cleaner: removes numbered citations with no References heading", () => {
  // KDIGO carries ~1000 of these and no "References" line anywhere, which is
  // why the section-marker cut alone left the file at 96% of its raw size.
  const raw = [
    "# Guideline",
    "## Chapter 1",
    "CKD is defined as abnormalities of kidney structure or function.",
    "3. Levey AS, de Jong PE, Coresh J, et al. The definition and classification.",
    "6. Gansevoort RT, Matsushita K, van der Velde M, et al. Lower estimated GFR.",
    "469. Wai SN, Kelly JT, Johnson DW, et al. Dietary patterns and outcomes.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assert(!/Levey AS/.test(body), "citation should be removed");
  assert(!/Gansevoort/.test(body), "citation should be removed");
  assert(!/Wai SN/.test(body), "citation should be removed");
  assertStringIncludes(body, "CKD is defined as abnormalities");
});

Deno.test("cleaner: numbered recommendations are not mistaken for citations", () => {
  // Real KDIGO content that opens exactly like a citation but is guidance.
  const raw = [
    "# Guideline",
    "## Chapter 1",
    "1. To ensure that the evidence base is directly applicable to patients.",
    "2. Decreased GFR should not be a reason for automatic dose reduction.",
    "3. Estimating equations equally applicable to those with and without CKD.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "evidence base is directly applicable");
  assertStringIncludes(body, "automatic dose reduction");
  assertStringIncludes(body, "Estimating equations equally applicable");
});

// ---------------------------------------------------------------------------
// Failed fetches that still return text
// ---------------------------------------------------------------------------

Deno.test("cleaner: strips ad-console debris from a page that never rendered", () => {
  // The Lancet GBD scrape returned this and no article text at all.
  const raw = [
    "# Article",
    "Skip to Main Content01853-7/fulltext#page-body-id",
    "SCROLL TO CONTINUE WITH CONTENT",
    "Open GPT Console",
    "Open Oracle Keywords",
    "Refresh Values",
    "| Moat Init | |",
    "| AdUnit | |",
    "| Custom Targeting | |",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ sourceId: "GBD" }));
  assert(!/GPT Console/i.test(body));
  assert(!/Moat Init/i.test(body));
  assert(!/SCROLL TO CONTINUE/i.test(body));
  assert(!/AdUnit/i.test(body));
});

Deno.test("cleaner: warns when a document has almost no prose", () => {
  // Generalises past the known junk markers: whatever the debris is, a real
  // document is mostly sentences.
  const raw = [
    "# Page",
    "## Nav",
    ...Array.from({ length: 40 }, (_, i) => `| Field ${i} | value |`),
    ...Array.from({ length: 20 }, (_, i) => `Fragment ${i}`),
  ].join("\n");
  const { report } = cleanDocument(raw, options());
  assert(
    report.warnings.some((w) => w.includes("sentence-like line")),
    `expected a prose-density warning, got ${JSON.stringify(report.warnings)}`,
  );
});

Deno.test("cleaner: a genuine article does not trip the prose-density warning", () => {
  const raw = [
    "# Article",
    "## Background",
    ...Array.from(
      { length: 10 },
      (_, i) =>
        `Chronic kidney disease affects the filtration capacity of the kidneys in ${i} distinct ways.`,
    ),
  ].join("\n");
  const { report } = cleanDocument(raw, options());
  assert(
    !report.warnings.some((w) => w.includes("sentence-like line")),
    `real prose should not warn: ${JSON.stringify(report.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Web boilerplate
// ---------------------------------------------------------------------------

Deno.test("cleaner: strips navigation and cookie boilerplate", () => {
  const raw = [
    "Skip to main content",
    "An official website of the United States government",
    "# What Is CKD?",
    "On this page",
    "## Definition",
    "CKD means lasting damage to the kidneys.",
    "Facebook",
    "Twitter",
    "Print",
    "Page last reviewed: March 2, 2026",
    "This site uses cookies to improve your experience.",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assert(!/skip to main content/i.test(body));
  assert(!/official website/i.test(body));
  assert(!/^Facebook$/m.test(body));
  assert(!/last reviewed/i.test(body));
  assert(!/cookies/i.test(body));
  assertStringIncludes(body, "CKD means lasting damage to the kidneys.");
});

Deno.test("cleaner: removes the federal .gov banner even when bolded", () => {
  // Regression from the first live CDC scrape. Firecrawl bolds this banner,
  // so anchored patterns saw "**Official…" and matched nothing. It prefaces
  // every CDC and NIDDK page — six of the twenty sources.
  const raw = [
    "**Official websites use .gov**",
    "A **.gov** website belongs to an official government organization in the United States.",
    "**Secure .gov websites use HTTPS**",
    "Share sensitive information only on official, secure websites.",
    "# Chronic Kidney Disease Basics",
    "## Key points",
    "More than 1 in 7 American adults has CKD.",
  ].join("\n");
  const { body } = cleanDocument(raw, options({ sourceId: "CDC" }));
  assert(!/official websites use/i.test(body));
  assert(!/belongs to an official government/i.test(body));
  assert(!/websites use HTTPS/i.test(body));
  assert(!/share sensitive information/i.test(body));
  assertStringIncludes(body, "More than 1 in 7 American adults has CKD.");
});

Deno.test("cleaner: never welds a space-separated .gov onto the word before it", () => {
  // Regression: the punctuation tidy rewrote "use .gov" to "use.gov",
  // corrupting text instead of tidying it.
  const raw = "# T\n\n## S\n\nRead more at the .gov site and the .org mirror.";
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "the .gov site");
  assertStringIncludes(body, "the .org mirror");
});

Deno.test("cleaner: still reattaches genuinely stranded punctuation", () => {
  // The other side of that lookahead — it must not disable the rule entirely.
  const raw = "# T\n\n## S\n\nRisk rises with age [12] . Filtration falls [13] .";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "with age.");
  assertStringIncludes(body, "falls.");
});

Deno.test("cleaner: removes empty brackets left by image removal", () => {
  const raw = "# T\n\n## S\n\nA lock ![lock icon](https://cdc.gov/l.png) () means it is secure.";
  const { body } = cleanDocument(raw, options());
  assert(!body.includes("()"), `empty parens survived: ${body}`);
});

Deno.test("cleaner: keeps prose that merely contains a boilerplate word", () => {
  // "share" and "print" are stripped as standalone nav lines only. A sentence
  // containing them is content and must survive.
  const raw = "# T\n\n## S\n\nShare your test results with your doctor.";
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "Share your test results with your doctor.");
});

Deno.test("cleaner: unwraps links and removes bare URLs", () => {
  const raw = [
    "# Doc",
    "## Section",
    "See the [NIDDK kidney disease page](https://www.niddk.nih.gov/kidney) for more.",
    "Visit https://example.org/tracker today.",
    "![A diagram of the kidney](https://example.org/img.png)",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "NIDDK kidney disease page");
  assert(!body.includes("https://"), "no URL should survive into a chunk");
  assert(!body.includes("!["), "image embeds should be gone");
});

Deno.test("cleaner: drops link-only navigation lines but keeps linked prose", () => {
  const raw = [
    "# Doc",
    "[Home](https://cdc.gov/) | [Kidney Disease](https://cdc.gov/kidney)",
    "## Section",
    "Read the [NIDDK guide](https://niddk.nih.gov/g) before your appointment.",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assert(!/Home/.test(body), "breadcrumb line should be dropped whole");
  assertStringIncludes(body, "Read the NIDDK guide before your appointment.");
});

Deno.test("cleaner: reattaches punctuation stranded by removals", () => {
  const raw = "# T\n\n## S\n\nRisk rises with age [12]. Filtration falls [13,14].";
  const { body } = cleanDocument(raw, options({ kind: "pdf" }));
  assertStringIncludes(body, "with age.");
  assertStringIncludes(body, "falls.");
  assert(!/ \./.test(body), "no space should precede a full stop");
});

Deno.test("cleaner: drops call-to-action stubs left behind by URL removal", () => {
  const raw = [
    "# Doc",
    "## Section",
    "Learn more at https://www.cdc.gov/kidney-disease/testing.html",
    "See your doctor about testing every year.",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assert(!/Learn more/.test(body), "the stub should be gone");
  assertStringIncludes(body, "See your doctor about testing every year.");
});

Deno.test("cleaner: trims a trailing CTA without touching the sentence before it", () => {
  // The real CDC page puts both on one line, which a line-anchored rule misses.
  const raw = [
    "# Doc",
    "## Section",
    "Adults with diabetes should be tested every year. Learn more at https://www.cdc.gov/t.html",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "Adults with diabetes should be tested every year.");
  assert(!/Learn more/.test(body), "the trailing CTA should be trimmed");
});

Deno.test("cleaner: a CTA-like phrase carrying real content is left alone", () => {
  const raw = "# T\n\n## S\n\nAsk for more information about your test results.";
  const { body } = cleanDocument(raw, options());
  assertStringIncludes(body, "Ask for more information about your test results.");
});

// ---------------------------------------------------------------------------
// Heading structure — the chunker's hard requirements
// ---------------------------------------------------------------------------

Deno.test("cleaner: does not let a publisher's name outrank the article title", () => {
  // Regression: scraped pages render the site name as an H1 above the real
  // one. Keeping it would make every heading_path in the corpus start with
  // the organisation instead of the article.
  const raw = [
    "# Centers for Disease Control and Prevention",
    "# Chronic Kidney Disease Basics",
    "## What is CKD?",
    "CKD means lasting kidney damage.",
  ].join("\n");
  const { body, report } = cleanDocument(raw, options({ sourceId: "CDC" }));
  assertEquals(report.headings.h1, 1);
  assert(
    /^# Chronic Kidney Disease Basics$/m.test(body),
    `article title should be the H1, got:\n${body}`,
  );
  assert(!/Centers for Disease Control/.test(body));
});

Deno.test("cleaner: generic nav words never delete a real heading", () => {
  // Regression: the chrome-heading rule once matched the "next/previous"
  // pagination pattern against "## Next Section" and deleted the section.
  const raw = [
    "# Doc",
    "## Next Section",
    "Content about staging.",
    "## Home Dialysis",
    "Content about dialysis at home.",
    "## Search for a Nephrologist",
    "Content about referral.",
  ].join("\n");
  const { body } = cleanDocument(raw, options());
  assert(/^## Next Section$/m.test(body), "'Next Section' is a real heading");
  assert(/^## Home Dialysis$/m.test(body), "'Home Dialysis' is a real heading");
  assert(
    /^## Search for a Nephrologist$/m.test(body),
    "'Search for…' is a real heading",
  );
});

Deno.test("cleaner: inserts an H1 when the source has none", () => {
  const raw = "## Only a section\n\nSome content here about kidneys.";
  const { body, report } = cleanDocument(
    raw,
    options({ title: "Fallback Title" }),
  );
  assertStringIncludes(body, "# Fallback Title");
  assertEquals(report.headings.h1, 1);
});

Deno.test("cleaner: demotes extra H1s and flattens H4+ to H3", () => {
  const raw = [
    "# Site Name",
    "# Article Title",
    "## Section",
    "#### Deep subsection",
    "##### Deeper still",
    "Content.",
  ].join("\n");
  const { body, report } = cleanDocument(raw, options());
  assertEquals(report.headings.h1, 1);
  assert(/^## Article Title$/m.test(body), "second H1 becomes H2");
  assert(/^### Deep subsection$/m.test(body), "H4 flattens to H3");
  assert(/^### Deeper still$/m.test(body), "H5 flattens to H3");
  assert(!/^#{4,}/m.test(body), "no heading deeper than H3 may remain");
});

Deno.test("cleaner: warns when there are no H2 sections to chunk on", () => {
  const raw = "# Title only\n\nA wall of text with no sections at all.";
  const { report } = cleanDocument(raw, options());
  assert(
    report.warnings.some((w) => w.includes("No H2 headings")),
    `expected an H2 warning, got: ${JSON.stringify(report.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Front-matter and the approval gate
// ---------------------------------------------------------------------------

Deno.test("cleaner: never emits approved: true", () => {
  const { markdown } = cleanDocument("# T\n\n## S\n\nContent.", options());
  assertStringIncludes(markdown, "approved: false");
  assert(!markdown.includes("approved: true"), "the cleaner may not approve");
});

Deno.test("cleaner: output is hard-rejected by the chunker until approved", () => {
  const { markdown } = cleanDocument(
    "# Doc\n\n## Section\n\nSome real content about kidney function.",
    options(),
  );
  let threw = false;
  try {
    chunkMarkdownDocument(markdown);
  } catch (err) {
    threw = true;
    assertStringIncludes(String(err), "not approved for ingestion");
  }
  assert(threw, "an unapproved cleaned document must not chunk");
});

Deno.test("cleaner: chunks cleanly once a human sets approved: true", () => {
  // The other half of the gate: nothing ELSE about the generated front-matter
  // may block ingestion, or curators would have to hand-rewrite every header.
  const { markdown } = cleanDocument(
    "# Doc\n\n## Section One\n\nContent about kidneys.\n\n## Section Two\n\nMore content.",
    options(),
  );
  const approved = markdown.replace("approved: false", "approved: true");
  const chunks = chunkMarkdownDocument(approved);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].source, "NIDDK");
  assertEquals(chunks[0].heading_path, "Doc > Section One");
  assertEquals(chunks[0].scopes, ["general_education"]);
});

Deno.test("cleaner: unregistered publishers get an unstorable source ID", () => {
  const { markdown, report } = cleanDocument(
    "# Doc\n\n## Section\n\nContent.",
    options({ sourceId: null }),
  );
  assertStringIncludes(markdown, `source: ${UNREGISTERED_SOURCE}`);
  assert(
    !isApprovedSource(UNREGISTERED_SOURCE),
    "the placeholder must never be an approved source",
  );
  assert(
    report.warnings.some((w) => w.includes("NOT on the approved source register")),
    "an unregistered publisher must warn",
  );
});

Deno.test("cleaner: quotes front-matter values that would confuse the parser", () => {
  const fm = buildFrontMatter(options({ title: "[Draft] Kidney Guide" }));
  assertStringIncludes(fm, 'title: "[Draft] Kidney Guide"');
});

// ---------------------------------------------------------------------------
// Access walls and thin pages
// ---------------------------------------------------------------------------

Deno.test("cleaner: flags paywall interstitials rather than passing them through", () => {
  const raw = "# Article\n\n## Abstract\n\nSign in to view the full text of this article. Purchase access to continue reading this content from the publisher today.";
  const { report } = cleanDocument(raw, options({ sourceId: null }));
  assert(
    report.warnings.some((w) => w.includes("Access-wall text detected")),
    `expected an access-wall warning, got: ${JSON.stringify(report.warnings)}`,
  );
});

Deno.test("cleaner: flags a suspiciously thin body", () => {
  const { report } = cleanDocument("# T\n\n## S\n\nShort.", options());
  assert(report.warnings.some((w) => w.includes("characters")));
});

// ---------------------------------------------------------------------------
// Manifest integrity — these guard the scraper's contract with the corpus
// ---------------------------------------------------------------------------

Deno.test("manifest: every sourceId is either null or an approved source", () => {
  for (const entry of MANIFEST) {
    if (entry.sourceId === null) continue;
    assert(
      isApprovedSource(entry.sourceId),
      `${entry.id} claims source "${entry.sourceId}", which is not on the ` +
        `approved register in _shared/sources.ts`,
    );
  }
});

Deno.test("manifest: every entry declares at least one valid retrieval scope", () => {
  for (const entry of MANIFEST) {
    assert(entry.scopes.length > 0, `${entry.id} has no scopes`);
    for (const scope of entry.scopes) {
      assert(
        isRetrievalScope(scope),
        `${entry.id} declares unknown scope "${scope}"`,
      );
    }
  }
});

Deno.test("manifest: ids and ranks are unique, and every fetchable entry has a URL", () => {
  const ids = new Set<string>();
  const ranks = new Set<number>();
  for (const entry of MANIFEST) {
    assert(!ids.has(entry.id), `duplicate manifest id: ${entry.id}`);
    assert(!ranks.has(entry.rank), `duplicate manifest rank: ${entry.rank}`);
    ids.add(entry.id);
    ranks.add(entry.rank);
    if (entry.kind === "local") {
      assertEquals(entry.url, "", `${entry.id} is local and must have no URL`);
    } else {
      assert(
        entry.url.startsWith("https://"),
        `${entry.id} must have an https URL`,
      );
    }
  }
});
