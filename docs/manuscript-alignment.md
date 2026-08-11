# Manuscript Alignment Summary — Hardened RAG for the General CKD Information Chatbot

*Phase 6 deliverable (spec §15). Plain-language material for the methodology
section, source list, and IPO diagram. This document describes the system; it
does not edit any manuscript file.*

## 1. Grounding approach: from system prompt to retrieval

Previously, the General CKD Information Chatbot carried its entire knowledge
base inside its system prompt. It now uses **retrieval-augmented generation
(RAG)**: curated content is split into semantically coherent passages
("chunks"), each converted into a 768-dimensional numerical vector (an
*embedding*, produced by Google's `gemini-embedding-001` model) and stored in
the project's Supabase Postgres database using the **pgvector** extension. When
a user asks a question, the system embeds the question the same way, retrieves
the most similar chunks by cosine similarity, and instructs the language model
to answer **only** from those retrieved passages. If nothing sufficiently
relevant is found, the chatbot declines instead of guessing.

## 2. Markdown-based knowledge store

Each approved source document is a human-readable **markdown file** under
`knowledge/` — filed in a folder per source category (`official-health-body/`,
`clinical-guidelines/`, `peer-reviewed/`) and per publishing body beneath it, so
the inclusion framework is visible in the tree itself — with a front-matter
block recording its source authority, title,
approval status, and last-updated date. Chunking follows the document's own
heading structure (H2 topic sections, H3 subsections kept with their parent),
so a staging table or symptom list stays intact in one chunk. Every stored
chunk carries the source ID and a heading breadcrumb (e.g. *"CKD Stages >
Stages of CKD > Stage 3"*), giving a human-auditable provenance trail from any
answer back to a named authority and section.

## 3. Approved source list (controlled input)

The knowledge base draws exclusively from the adviser-approved list: **DOH,
PSN, WHO, CDC, NIDDK, KDIGO, AstraZeneca Philippines**, plus the **SCORED**
instrument citation. This whitelist is enforced in three places: a Postgres
CHECK constraint on the `source` column (the database physically rejects
off-list rows), validation in the chunking/ingestion script, and the citation
layer of the chatbot. Candidate additions (KDIGO 2024 guideline, NKF/KDOQI,
NIDDK/NKDEP, ISN, PhilHealth) remain **pending adviser sign-off** and are not
ingested. Diet and other clinically sensitive content is tracked in a review
ledger (`knowledge/REVIEW-FLAGS.md`) and only ingested once cleared.

## 4. Scope guardrail + anti-injection design

The chatbot answers **only** CKD and adjacent kidney-health questions,
enforced in three inexpensive layers (defense in depth):

1. **Input gate** — before any retrieval, a lightweight classifier
   (`gemini-2.5-flash-lite`) returns a JSON verdict
   `{in_scope, injection_detected, reason}`; a regex pre-screen catches known
   prompt-injection patterns (instruction-override, "print your system
   prompt", role-swap, delimiter-breaking) without any API call. Off-topic or
   flagged inputs get a fixed, polite deflection.
2. **Retrieval threshold** — even in-scope questions deflect if no retrieved
   chunk clears the reranker's relevance threshold, so weak matches are never
   forced to fit.
3. **Hardened system prompt** — the generation prompt restates the CKD-only
   boundary, forbids revealing or altering its instructions, and treats all
   delimited content as untrusted data.

The generator's input keeps a strict **trust separation**: the system prompt
is the only instruction region; retrieved chunks and the user's question are
wrapped in labeled *untrusted data* delimiters and can never add instructions.
A post-generation output check replaces any draft that leaks the system prompt
or claims its rules changed. All database access is read-only and
parameterized; browser clients cannot read the vector store at all
(deny-by-default row-level security).

## 5. Reranking retrieval flow (for the IPO diagram)

**Input:** user question →
**Process:** (1) scope + injection gate → (2) query embedding
(`gemini-embedding-001`, 768-dim) → (3) pgvector cosine recall, top-20
candidates above a 0.45 similarity floor → (4) **Cohere Rerank v3.5**
cross-encoder keeps the top-4 candidates scoring ≥ 0.30 relevance (if the
rerank service is unavailable, the system degrades to a stricter 0.60 cosine
rule rather than failing) → (5) grounded generation with mandatory
source citation → (6) output safety check →
**Output:** cited educational answer, or the standard deflection.

The two-stage design separates *recall* (the vector search casts a wide net)
from *precision* (the reranker, which reads the actual question–passage pair,
decides what is truly relevant). This measurably reduces both missed answers
and off-topic leakage compared with a single similarity cutoff.

## 6. Source-attribution guarantee

Every substantive claim in an answer is citable to a named approved source
because (a) every chunk row physically carries its source ID and heading path,
(b) the generator is instructed to name the source of each claim and to say so
when the retrieved material is insufficient, and (c) the response payload
returns the source/section list alongside the reply so the UI can display
provenance. An answer that cannot be grounded in an approved source is not
produced — the chatbot deflects instead.
