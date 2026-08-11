// BATO — the scrape manifest: the 20 approved knowledge-base sources.
//
// This file is the machine-readable form of SOURCES.md. SOURCES.md stays the
// human document (it carries the "why it earns a slot" rationale); this is
// what the scraper actually iterates. Keep them in sync by hand — a source
// added here without a line in SOURCES.md has no recorded justification, and
// justification is what the inclusion framework is.
//
// PURE module: no network, no Deno.env, no file I/O. Import-time
// side-effect-free so tests and --dry-run can load it freely (same rule
// chunker.ts and scopes.ts follow).
//
// ===== THE sourceId FIELD IS THE IMPORTANT ONE =====
//
// knowledge_chunks.source is a foreign key onto public.knowledge_sources, so
// a scraped document whose publisher is not on that register is UNSTORABLE by
// construction, no matter how good the content is.
//
// Every entry below now carries a registered `sourceId`: the nine publishers
// that were outstanding (NICE, KDOQI, ISN, APSN, PSH, GBD, CHEN2019, PHCOI,
// PHESRD) were approved by the adviser on 2026-08-10 and registered in
// 20260810000001_register_top20_sources.sql.
//
// `sourceId: null` remains legal and meaningful for anything added later. It
// is not an oversight to be patched by picking the nearest-looking ID — it is
// the honest statement that a human has not yet registered the publisher with
// adviser sign-off. The cleaner propagates it into front-matter as an
// UNREGISTERED marker so chunkMarkdownDocument() throws rather than letting a
// document slip into the corpus attributed to somebody who did not publish it.
//
// To add a source: register the row in public.knowledge_sources, mirror it in
// _shared/sources.ts, then set sourceId here. All three, or none — the
// manifest test in tests/cleaner_test.ts fails on an ID the register does not
// know, which catches two of the three orderings.
//
// REGISTRATION IS NOT INGESTION. A registered source only means a chunk may
// be ATTRIBUTED to it. The content still passes curation, REVIEW-FLAGS
// logging and `approved: true` before anything is embedded.

/** How the source must be fetched. */
export type SourceKind =
  | "web" // HTML page; Firecrawl scrape endpoint
  | "pdf" // PDF URL; Firecrawl parses it server-side
  | "local"; // Already on disk in the repo — never fetched

/**
 * Whether the document is freely readable at the URL.
 *
 * `restricted` does NOT mean "scrape it anyway with a workaround". It means
 * the scraper is expected to come back with an abstract, a paywall
 * interstitial, or an error, and that this is a normal outcome to be logged
 * rather than defeated. Obtain those through the university's library access
 * and drop the text in scraped/raw/ by hand if you need the full article.
 */
export type AccessLevel = "open" | "restricted";

export interface ManifestEntry {
  /** Stable slug — names the raw and cleaned output files. */
  id: string;
  /** Row number in SOURCES.md, for cross-referencing. */
  rank: number;
  /** Human title, copied from SOURCES.md. */
  title: string;
  /** Fetch target. Empty string for `local` entries. */
  url: string;
  kind: SourceKind;
  /**
   * Approved source ID from _shared/sources.ts, or null when the publisher
   * is not yet on the register. See the header note — null is load-bearing.
   */
  sourceId: string | null;
  /** Retrieval scopes the resulting chunks would belong to, once curated. */
  scopes: string[];
  /** Seed topic tags; the curator refines these. */
  topicTags: string[];
  access: AccessLevel;
  /** Licence / reuse position, recorded so curation decisions are auditable. */
  licence: string;
  /** Anything the scraper or curator needs to know. */
  notes?: string;
  /**
   * Why this source is not fetchable, when it is not.
   *
   * Set from OBSERVED failure, never from expectation. A source is excluded
   * once a real scrape has come back with something that is not the document
   * — a paywall stub, or a page shell whose article never rendered. The entry
   * stays in the manifest rather than being deleted, because SOURCES.md still
   * lists it and the reason it cannot be automated is itself the finding: it
   * tells the curator to obtain the text through library access instead of
   * quietly re-running the scraper and getting the same junk.
   */
  excluded?: string;
}

export const MANIFEST: readonly ManifestEntry[] = [
  {
    id: "kdigo-2024-ckd-guideline",
    rank: 1,
    title: "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of CKD",
    url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    kind: "pdf",
    sourceId: "KDIGO",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["ckd", "definition", "egfr", "albuminuria", "staging"],
    access: "open",
    licence: "KDIGO guideline, freely distributed; cite, do not reproduce wholesale.",
    notes:
      "Large document (100+ pages). Expect a long Firecrawl parse and a big " +
      "raw file. This is the definitional spine — curate narrow excerpts, " +
      "not the whole guideline.",
  },
  {
    id: "niddk-what-is-ckd",
    rank: 2,
    title: "NIDDK — What Is Chronic Kidney Disease?",
    url: "https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/what-is-chronic-kidney-disease",
    kind: "web",
    sourceId: "NIDDK",
    scopes: ["general_education"],
    topicTags: ["ckd", "basics", "definition"],
    access: "open",
    licence: "US Government work; public domain.",
  },
  {
    id: "niddk-tests-diagnosis",
    rank: 3,
    title: "NIDDK — Chronic Kidney Disease Tests & Diagnosis",
    url: "https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/tests-diagnosis",
    kind: "web",
    sourceId: "NIDDK",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["diagnosis", "tests", "egfr", "uacr"],
    access: "open",
    licence: "US Government work; public domain.",
  },
  {
    id: "cdc-ckd-basics",
    rank: 4,
    title: "CDC — Chronic Kidney Disease Basics",
    url: "https://www.cdc.gov/kidney-disease/about/index.html",
    kind: "web",
    sourceId: "CDC",
    scopes: ["general_education"],
    topicTags: ["ckd", "basics", "risk-factors"],
    access: "open",
    licence: "US Government work; public domain.",
  },
  {
    id: "cdc-ckd-common-serious-costly",
    rank: 5,
    title: "CDC — CKD Is Common, Serious, and Costly",
    url: "https://www.cdc.gov/kidney-disease/ckd-facts/index.html",
    kind: "web",
    sourceId: "CDC",
    scopes: ["general_education"],
    topicTags: ["burden", "awareness", "statistics"],
    access: "open",
    licence: "US Government work; public domain.",
  },
  {
    id: "scored-bang-2007",
    rank: 6,
    title: "Bang et al. 2007 — SCORED (Screening for Occult Renal Disease)",
    url: "",
    kind: "local",
    sourceId: "SCORED",
    scopes: ["screening_clarification"],
    topicTags: ["scored", "screening", "instrument", "risk-score"],
    access: "restricted",
    licence:
      "Arch Intern Med. 2007;167(4):374-381. Instrument used under AMA " +
      "licence 5263480664527 (AstraZeneca Philippines patient card).",
    notes:
      "NOT SCRAPED — the paper is a project file (SCORED.pdf), not a URL, so " +
      "the scraper skips this entry by design. Its text was transcribed into " +
      "scraped/raw/scored-bang-2007.md by hand on 2026-08-10 from the PDF. " +
      "The 57-item reference list was omitted at transcription (the cleaner's " +
      "apparatus rules would strip it anyway); everything else — abstract, " +
      "methods, Table 2 scores, Table 3 diagnostics, the Figure 2 patient " +
      "questionnaire and the published 2007 correction carrying the -5.4 " +
      "intercept — is present. Verify every figure against the PDF before " +
      "approving: this is the instrument of record.",
  },
  {
    id: "niddk-uacr-gfr-quick-reference",
    rank: 7,
    title: "NIDDK — Quick Reference on UACR & GFR",
    url: "https://www.niddk.nih.gov/health-information/professionals/advanced-search/quick-reference-uacr-gfr",
    kind: "web",
    sourceId: "NIDDK",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["uacr", "gfr", "albuminuria", "definition"],
    access: "open",
    licence: "US Government work; public domain.",
    notes:
      "Clinician-facing register. Expect heavy numeric content — every " +
      "chunk from this will trip the REVIEW-FLAGS gate in ingest-knowledge.ts.",
  },
  {
    id: "who-wha78-6-kidney-health",
    rank: 8,
    title: "WHO — Resolution WHA78.6 on Kidney Health",
    url: "https://apps.who.int/gb/ebwha/pdf_files/WHA78/A78_R6-en.pdf",
    kind: "pdf",
    sourceId: "WHO",
    scopes: ["general_education"],
    topicTags: ["policy", "who", "screening", "kidney-health"],
    access: "open",
    licence: "WHO governing-body document; reproduction permitted with attribution.",
  },
  {
    id: "ph-cost-of-illness-ckd",
    rank: 9,
    title: "Cost-of-illness analysis of chronic kidney disease in the Philippines",
    url: "https://www.tandfonline.com/doi/full/10.1080/13696998.2025.2481766",
    kind: "web",
    // Registered 2026-08-10, removed from the register 2026-08-11 — an
    // unfetchable source can never have a chunk to attribute. Back to null,
    // which is the honest state: no approved publisher backs this entry.
    sourceId: null,
    scopes: ["general_education"],
    topicTags: ["philippines", "burden", "cost", "economics"],
    access: "restricted",
    licence:
      "Journal of Medical Economics (Taylor & Francis). Check the article's " +
      "own licence — may be paywalled or author-choice OA.",
    excluded:
      "Scraped 2026-08-10 and returned 435 raw characters — a paywall stub, " +
      "not the article (122 chars survived cleaning). Taylor & Francis gates " +
      "the full text. Obtain via university library access and drop the text " +
      "in scraped/raw/ph-cost-of-illness-ckd.md by hand.",
  },
  {
    id: "gbd-2023-ckd-lancet",
    rank: 10,
    title: "GBD 2023 — Global, regional, and national burden of CKD (Lancet, 2025)",
    url: "https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(25)01853-7/fulltext",
    kind: "web",
    // Registered 2026-08-10, removed from the register 2026-08-11 — see the
    // PHCOI entry above. Reinstate only once the text is actually in hand.
    sourceId: null,
    scopes: ["general_education"],
    topicTags: ["burden", "statistics", "global", "gbd"],
    access: "open",
    licence: "CC BY 4.0 — reuse permitted with attribution.",
    excluded:
      "Scraped 2026-08-10 and returned 980 characters of ADVERTISING CONSOLE " +
      "— 'Open GPT Console', 'Moat Init', an ad-targeting table — with no " +
      "article text at all. The Lancet renders the paper client-side, so the " +
      "fetch succeeds while the content never arrives. The licence is CC BY " +
      "4.0, so the text is freely reusable once obtained: download the PDF " +
      "and drop it in scraped/raw/gbd-2023-ckd-lancet.md by hand.",
  },
  {
    id: "nice-ng203-ckd",
    rank: 11,
    title: "NICE NG203 — Chronic kidney disease: assessment and management",
    url: "https://www.nice.org.uk/guidance/ng203/resources/chronic-kidney-disease-assessment-and-management-pdf-66143713055173",
    kind: "pdf",
    sourceId: "NICE",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["guideline", "testing", "risk-communication"],
    access: "open",
    licence:
      "NICE content is subject to the NICE UK Open Content Licence — " +
      "non-commercial reuse with attribution; verify terms before curating.",
    notes:
      "Large PDF. Registered as the 2021 NG203 publication — if a later " +
      "revision is curated in, update knowledge_sources.publication_year " +
      "rather than letting the year drift from the text.",
  },
  {
    id: "niddk-ckd-hub",
    rank: 12,
    title: "NIDDK — Chronic Kidney Disease (CKD) hub",
    url: "https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd",
    kind: "web",
    sourceId: "NIDDK",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["ckd", "risk-factors", "hub"],
    access: "open",
    licence: "US Government work; public domain.",
    notes:
      "Hub page — mostly navigation. Expect the cleaner to strip a high " +
      "proportion of it and warn about a thin body.",
  },
  {
    id: "kdoqi-nutrition-2020",
    rank: 13,
    title: "KDOQI Clinical Practice Guideline for Nutrition in CKD: 2020 Update",
    url: "https://www.ajkd.org/article/s0272-6386(20)30726-5/pdf",
    kind: "pdf",
    sourceId: "KDOQI",
    scopes: ["general_education"],
    topicTags: ["diet", "nutrition", "protein", "sodium", "potassium"],
    access: "open",
    licence:
      "AJKD / National Kidney Foundation. Verify reuse terms — this is not " +
      "a public-domain source.",
    notes:
      "Diet guidance is the single most review-sensitive content class in " +
      "this project (REVIEW-FLAGS §6): every quantitative chunk needs " +
      "adviser sign-off before ingestion.",
  },
  {
    id: "cdc-ckd-initiative",
    rank: 14,
    title: "CDC — Chronic Kidney Disease Initiative hub",
    url: "https://www.cdc.gov/kidney-disease/index.html",
    kind: "web",
    sourceId: "CDC",
    scopes: ["general_education"],
    topicTags: ["prevention", "self-care", "hub"],
    access: "open",
    licence: "US Government work; public domain.",
  },
  {
    id: "ph-esrd-gaps-challenges",
    rank: 15,
    title: "Gaps and challenges in the treatment of ESRD in the Philippines",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10544423/",
    kind: "web",
    sourceId: "PHESRD",
    scopes: ["general_education"],
    topicTags: ["philippines", "dialysis", "philhealth", "access"],
    access: "open",
    licence: "PMC open access — check the individual article's licence statement.",
  },
  {
    id: "chen-grams-jama-2019",
    rank: 16,
    title: "Chen, Knicely & Grams — Chronic Kidney Disease Diagnosis and Management (JAMA 2019)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7015670/",
    kind: "web",
    sourceId: "CHEN2019",
    scopes: ["general_education"],
    topicTags: ["review", "diagnosis", "management"],
    access: "open",
    licence: "PMC author manuscript — check the article's licence statement.",
  },
  {
    id: "who-pen-primary-care",
    rank: 17,
    title: "WHO — Package of Essential NCD Interventions (PEN) for Primary Health Care",
    url: "https://qualityhealthservices.who.int/quality-toolkit/qt-catalog-item/who-package-of-essential-noncommunicable-(-pen)-disease-interventions-for-primary-health-care",
    kind: "web",
    sourceId: "WHO",
    scopes: ["general_education"],
    topicTags: ["primary-care", "ncd", "philpen", "screening"],
    access: "open",
    licence: "WHO publication; reproduction permitted with attribution.",
    notes:
      "Catalogue landing page — the substantive content may sit behind a " +
      "download link rather than on the page itself.",
  },
  {
    id: "isn-global-kidney-health-atlas-2023",
    rank: 18,
    title: "ISN — Global Kidney Health Atlas 2023",
    url: "https://www.theisn.org/wp-content/uploads/media/ISN%20Atlas_2023%20Digital_REV_2023_10_03.pdf",
    kind: "pdf",
    sourceId: "ISN",
    scopes: ["general_education"],
    topicTags: ["atlas", "western-pacific", "capacity", "global"],
    access: "open",
    licence: "International Society of Nephrology; verify reuse terms.",
    notes:
      "Very large PDF — heavy figures and tables, so expect the cleaner to " +
      "strip a lot and the surviving text to need close curation.",
  },
  {
    id: "apsn-diabetic-kidney-disease-2025",
    rank: 19,
    title: "APSN — Diabetic Kidney Disease: 2025 Update",
    url: "https://onlinelibrary.wiley.com/doi/10.1111/nep.70030",
    kind: "web",
    sourceId: "APSN",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["diabetes", "dkd", "asia-pacific"],
    access: "restricted",
    licence: "Nephrology (Wiley). Likely subscription-gated.",
    notes:
      "Wiley commonly serves a consent/paywall interstitial — an " +
      "abstract-only or failed scrape is the expected outcome, not a bug to " +
      "work around.",
  },
  {
    id: "ph-hypertension-cpg-2020",
    rank: 20,
    title: "2020 Philippine Clinical Practice Guidelines on Hypertension",
    url: "https://www.philippinesocietyofhypertension.org.ph/ClinicalPracticeGuidelines.pdf",
    kind: "pdf",
    sourceId: "PSH",
    scopes: ["general_education", "screening_clarification"],
    topicTags: ["hypertension", "philippines", "blood-pressure"],
    access: "open",
    licence: "Philippine Society of Hypertension; verify reuse terms.",
    notes:
      "PSH is NOT PSN (Philippine Society of Nephrology) — two Philippine " +
      "specialty societies with adjacent acronyms. Do not cross-attribute.",
  },
] as const;

/** Entries the scraper will actually fetch: not local, not excluded. */
export const FETCHABLE = MANIFEST.filter(
  (e) => e.kind !== "local" && e.excluded === undefined,
);

/** Entries a real scrape proved cannot be fetched automatically. */
export const EXCLUDED = MANIFEST.filter((e) => e.excluded !== undefined);

/** Look up a manifest entry by slug. */
export function entryById(id: string): ManifestEntry | undefined {
  return MANIFEST.find((e) => e.id === id);
}

/** Entries whose publisher is not yet on the approved source register. */
export const UNREGISTERED = MANIFEST.filter((e) => e.sourceId === null);
