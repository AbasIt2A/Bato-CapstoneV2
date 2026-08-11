// Approved source attribution for the shared RAG corpus.
//
// Every stored chunk and every citation either chatbot produces must trace to
// one of these IDs — nothing hallucinated, nothing off-list.
//
// ⚠️ AUTHORITY NOTE. public.knowledge_sources is now the register of record:
// it carries each source's inclusion-framework category, publication year and
// adviser approval date, and knowledge_chunks.source is a foreign key onto
// it, so an unregistered source is physically unstorable regardless of what
// this file says. What follows is the deployed mirror of that table, used for
// citation display and for fast offline validation in the chunker (which runs
// before any database connection exists).
//
// Adding a source therefore means: register the row (with adviser sign-off)
// AND mirror it here. Registering without mirroring makes citations render
// with a bare ID; mirroring without registering makes ingestion fail on the
// foreign key. Neither silently admits off-framework material.

/** The three admissible source categories of the inclusion framework. */
export type SourceCategory =
  | "official_health_body"
  | "clinical_guideline"
  | "peer_reviewed";

export interface SourceInfo {
  /** Stable ID stored on knowledge_chunks.source and used in citations. */
  id: string;
  /** Full display name for citations / frontend rendering. */
  name: string;
  /** Inclusion-framework category; mirrors knowledge_sources.category. */
  category: SourceCategory;
}

export const SOURCES: readonly SourceInfo[] = [
  {
    id: "DOH",
    name: "Department of Health (Philippines)",
    category: "official_health_body",
  },
  {
    id: "PSN",
    name: "Philippine Society of Nephrology",
    category: "official_health_body",
  },
  {
    // The national statistics authority and sole official publisher of
    // Philippine registered-death counts by cause. Approved 2026-08-06.
    // NOTE: PSA reports mortality by ICD cause group ("nephritis, nephrotic
    // syndrome and nephrosis"), which is NOT coextensive with CKD — any
    // chunk citing PSA must carry that caveat.
    id: "PSA",
    name: "Philippine Statistics Authority",
    category: "official_health_body",
  },
  {
    id: "WHO",
    name: "World Health Organization",
    category: "official_health_body",
  },
  {
    id: "CDC",
    name: "US Centers for Disease Control and Prevention",
    category: "official_health_body",
  },
  {
    id: "NIDDK",
    name:
      "National Institute of Diabetes and Digestive and Kidney Diseases",
    category: "official_health_body",
  },
  {
    id: "KDIGO",
    name: "Kidney Disease: Improving Global Outcomes",
    category: "clinical_guideline",
  },
  {
    // Official body here in its capacity as the licensed publisher of the
    // SCORED patient questionnaire in the Philippines (AMA licence
    // 5263480664527), not as a commercial health portal — those are excluded.
    id: "AstraZeneca",
    name: "AstraZeneca Philippines",
    category: "official_health_body",
  },
  {
    // Foundational to the instrument itself, so exempt from the ten-year
    // currency rule that otherwise applies to journal literature.
    id: "SCORED",
    name: "Bang et al., 2007 (SCORED study, JAMA Internal Medicine)",
    category: "peer_reviewed",
  },

  // --- Admitted 2026-08-10 with the Top 20 source list (SOURCES.md). See
  // 20260810000001_register_top20_sources.sql for the category rationale,
  // including the two arguable placements (ISN, APSN). ---------------------

  // PHCOI (Philippine cost-of-illness) and GBD (Lancet 2023 burden) were
  // registered here on 2026-08-10 and REMOVED from public.knowledge_sources
  // on 2026-08-11 — neither can be fetched (a Taylor & Francis paywall and a
  // Lancet page whose article never renders), so neither will ever have a
  // chunk to attribute. They are dropped from this mirror to match the
  // register, which is the authority. To reinstate one: obtain the text,
  // re-run the insert in 20260810145929_register_top20_sources.sql for that
  // ID, restore the entry here, and clear `excluded` in the scrape manifest.
  {
    // Local care pathway, PhilHealth coverage and dialysis access context.
    id: "PHESRD",
    name:
      "Gaps and Challenges in the Treatment of End-Stage Renal Disease in " +
      "the Philippines (PMC10544423, 2023)",
    category: "peer_reviewed",
  },
  {
    // NOT PSN. The Philippine Society of Hypertension publishes the local BP
    // guidance; the Philippine Society of NEPHROLOGY is a separate registered
    // source. Adjacent acronyms, different bodies — do not cross-attribute.
    id: "PSH",
    name: "Philippine Society of Hypertension",
    category: "clinical_guideline",
  },
  {
    id: "CHEN2019",
    name:
      "Chen, Knicely & Grams, 2019 (Chronic Kidney Disease Diagnosis and " +
      "Management, JAMA)",
    category: "peer_reviewed",
  },
  {
    id: "NICE",
    name: "National Institute for Health and Care Excellence (UK)",
    category: "clinical_guideline",
  },
  {
    id: "KDOQI",
    name:
      "Kidney Disease Outcomes Quality Initiative (National Kidney Foundation)",
    category: "clinical_guideline",
  },
  {
    // The Global Kidney Health Atlas is a capacity survey rather than a
    // guideline; filed here as a peer nephrology body. See the migration.
    id: "ISN",
    name: "International Society of Nephrology (Global Kidney Health Atlas)",
    category: "clinical_guideline",
  },
  {
    id: "APSN",
    name: "Asian Pacific Society of Nephrology",
    category: "clinical_guideline",
  },
] as const;

/** The ONLY approved source IDs. Reject anything not in this list. */
export const APPROVED_SOURCE_IDS: readonly string[] = SOURCES.map((s) => s.id);

/** Display name for citations, keyed by source ID. */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s.name]),
);

/** Inclusion-framework category, keyed by source ID. */
export const SOURCE_CATEGORIES: Record<string, SourceCategory> = Object
  .fromEntries(SOURCES.map((s) => [s.id, s.category]));

const APPROVED_SET = new Set(APPROVED_SOURCE_IDS);

/** True iff `id` is one of the approved source IDs (exact match, case-sensitive). */
export function isApprovedSource(id: string): boolean {
  return APPROVED_SET.has(id);
}
