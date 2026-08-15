// Where each source chip points.
//
// A citation reaches the frontend as `{ source, title, heading_path }` — the
// source ID ("NIDDK", "KDOQI") and the passage it came from, and nothing
// else. Neither the payload nor the register behind it
// (supabase/functions/_shared/sources.ts) carries a URL, so a reader who
// wanted to check a claim against the publisher had to go and find the
// publisher themselves. This table closes that gap: one public page per
// registered source, so every chip can be a link.
//
// ===== WHY THIS LIVES IN THE FRONTEND =====
//
// The obvious home is the register mirror in _shared/sources.ts, with the URL
// travelling in the citation payload. Two reasons it is the wrong home:
//
//   1. answer_cache stores the citation payload verbatim and has no TTL (see
//      answer-cache.ts). Every reply cached before such a field existed would
//      keep its URL-less sources forever — dead chips on exactly the
//      questions asked most often, with nothing to eventually clear them.
//   2. Where a chip POINTS is presentation. The server's job is to say which
//      sources grounded the answer, and it already does that, verifiably
//      (see citations.ts). It does not need to know about hyperlinks.
//
// Resolving by ID on the client needs no cache invalidation, no migration and
// no Edge Function redeploy, and it lights up the chips on already-cached
// answers too.
//
// ===== ONE URL PER SOURCE, NOT PER DOCUMENT =====
//
// The chips are per SOURCE, and a source ID does not identify a document. A
// curated file may credit publishers inline that did not publish it —
// knowledge/official-health-body/niddk/diet-and-lifestyle.md is a NIDDK file
// citing WHO, CDC, KDIGO, KDOQI and APSN, and citations.ts admits those
// inline credits as citable. So an APSN chip can legitimately come from a
// NIDDK page, and linking a chip to the document its chunk sat in would point
// the reader at the wrong body.
//
// Where a source IS one document (KDIGO's 2024 guideline, NICE NG203, the
// SCORED paper, the two journal articles), the URL is that document. Where it
// is a publisher of several corpus files (NIDDK, CDC, WHO, DOH), it is that
// publisher's kidney-disease landing page. Every URL below was verified
// reachable on 2026-08-16.
//
// A source with no `url` renders as a plain, unlinked chip. That is not an
// omission to be patched with the nearest-looking page — it is the honest
// state for AstraZeneca, whose contribution is a licensed print patient card
// with no public page of its own.
//
// Keep in sync with supabase/functions/_shared/sources.ts:
// tests/source_links_test.ts fails when an approved ID is missing here or
// when a name drifts from the register.

export interface SourceReference {
  /** Publisher's full name. Mirrors SOURCE_DISPLAY_NAMES in the register. */
  name: string;
  /** Public page for this source; absent when the source has no public page. */
  url?: string;
}

export const SOURCE_REFERENCES: Record<string, SourceReference> = {
  DOH: {
    name: "Department of Health (Philippines)",
    // The CKD Prevention and Control Program page, not doh.gov.ph's root —
    // the corpus content is that programme's.
    url:
      "https://doh.gov.ph/uhc/health-programs/chronic-kidney-disease-prevention-and-control/",
  },
  PSN: {
    name: "Philippine Society of Nephrology",
    // NOT philippinesocietyofhypertension.org.ph — see PSH below. Two
    // Philippine societies with adjacent acronyms; crossing them here would
    // send a reader checking a nephrology claim to a hypertension guideline.
    url: "https://psn.org.ph/",
  },
  PSA: {
    name: "Philippine Statistics Authority",
    // Vital-statistics index rather than one year's release: the corpus
    // quotes registered-death counts, and the latest release supersedes the
    // one a chunk was curated from.
    url: "https://psa.gov.ph/statistics/vital-statistics/index",
  },
  WHO: {
    name: "World Health Organization",
    // The kidney-disease fact sheet. Both WHO files in the corpus
    // (statistics-and-burden.md, kidney-health-policy.md) sit behind this
    // topic; the WHA78.6 resolution PDF is one of their two sources and
    // would under-serve the other.
    url: "https://www.who.int/news-room/fact-sheets/detail/kidney-disease",
  },
  CDC: {
    name: "US Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/kidney-disease/index.html",
  },
  NIDDK: {
    name: "National Institute of Diabetes and Digestive and Kidney Diseases",
    url:
      "https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd",
  },
  KDIGO: {
    name: "Kidney Disease: Improving Global Outcomes",
    // Guideline landing page rather than the 100-page PDF the corpus was
    // curated from — same document, without dropping a phone user into a
    // multi-megabyte download.
    url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/",
  },
  AstraZeneca: {
    name: "AstraZeneca Philippines",
    // Deliberately no URL. The contribution is the printed SCORED patient
    // card licensed under AMA licence 5263480664527, which has no public
    // page; astrazeneca.com.ph is a corporate site, not this source.
  },
  SCORED: {
    name: "Bang et al., 2007 (SCORED study, JAMA Internal Medicine)",
    url: "https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/411731",
  },
  PHESRD: {
    name:
      "Gaps and Challenges in the Treatment of End-Stage Renal Disease in " +
      "the Philippines (PMC10544423, 2023)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10544423/",
  },
  PSH: {
    name: "Philippine Society of Hypertension",
    // The 2020 Philippine CPG on Hypertension itself (a PDF) — the society
    // publishes it directly.
    url:
      "https://www.philippinesocietyofhypertension.org.ph/ClinicalPracticeGuidelines.pdf",
  },
  CHEN2019: {
    name:
      "Chen, Knicely & Grams, 2019 (Chronic Kidney Disease Diagnosis and " +
      "Management, JAMA)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7015670/",
  },
  NICE: {
    name: "National Institute for Health and Care Excellence (UK)",
    // NG203 overview, which links its own PDF and public-information version.
    url: "https://www.nice.org.uk/guidance/ng203",
  },
  KDOQI: {
    name:
      "Kidney Disease Outcomes Quality Initiative (National Kidney Foundation)",
    // AJKD full text of the 2020 nutrition update, not the /pdf variant.
    url: "https://www.ajkd.org/article/S0272-6386(20)30726-5/fulltext",
  },
  ISN: {
    name: "International Society of Nephrology (Global Kidney Health Atlas)",
    url:
      "https://www.theisn.org/wp-content/uploads/media/ISN%20Atlas_2023%20Digital_REV_2023_10_03.pdf",
  },
  APSN: {
    name: "Asian Pacific Society of Nephrology",
    // Wiley may serve a paywall interstitial for the 2025 Diabetic Kidney
    // Disease update. That is the article's real home, so it is still the
    // right destination — the reader lands on the record, not a guess.
    url: "https://onlinelibrary.wiley.com/doi/10.1111/nep.70030",
  },
};

/** The reference for a source ID, or undefined for an unknown ID. */
export function sourceReference(id: string): SourceReference | undefined {
  return SOURCE_REFERENCES[id];
}

/** Host of a URL without "www.", for a tooltip that says where a chip goes. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
