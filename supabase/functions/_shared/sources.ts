// Approved source attribution for the General CKD Chatbot (hardened-RAG
// spec §3.3, §5). Every stored chunk and every citation the chatbot produces
// must trace to one of these IDs — nothing hallucinated, nothing off-list.
//
// ⚠️ This list is controlled input curated by the student with adviser
// sign-off. Do not add or remove entries here without that approval.

export interface SourceInfo {
  /** Stable ID stored on knowledge_chunks.source and used in citations. */
  id: string;
  /** Full display name for citations / frontend rendering. */
  name: string;
}

export const SOURCES: readonly SourceInfo[] = [
  { id: "DOH", name: "Department of Health (Philippines)" },
  { id: "PSN", name: "Philippine Society of Nephrology" },
  { id: "WHO", name: "World Health Organization" },
  { id: "CDC", name: "US Centers for Disease Control and Prevention" },
  {
    id: "NIDDK",
    name:
      "National Institute of Diabetes and Digestive and Kidney Diseases",
  },
  { id: "KDIGO", name: "Kidney Disease: Improving Global Outcomes" },
  { id: "AstraZeneca", name: "AstraZeneca Philippines" },
  { id: "SCORED", name: "Bang et al., 2007 (SCORED study, JAMA Internal Medicine)" },
] as const;

/** The ONLY approved source IDs. Reject anything not in this list. */
export const APPROVED_SOURCE_IDS: readonly string[] = SOURCES.map((s) => s.id);

/** Display name for citations, keyed by source ID. */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s.name]),
);

const APPROVED_SET = new Set(APPROVED_SOURCE_IDS);

/** True iff `id` is one of the approved source IDs (exact match, case-sensitive). */
export function isApprovedSource(id: string): boolean {
  return APPROVED_SET.has(id);
}
