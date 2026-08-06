# REVIEW FLAGS — clinical adviser sign-off required before ingestion

This document lists every clinically sensitive or unattributed item in the
`knowledge/*.md` files. A clinical adviser (and/or the manuscript sources)
MUST verify each item below before `scripts/ingest-knowledge-md.ts` is run.
Nothing in `knowledge/` has been embedded or ingested — this is a draft.

All content was converted verbatim (facts unchanged) from the already-vetted
`supabase/functions/_shared/knowledge-base.ts` and
`supabase/functions/_shared/rag-content.ts`. No new clinical content was
fetched or invented. The flags below are the numbers and boundaries that most
need a second clinical read because they drive what BATO tells users.

---

## 1. eGFR stage cutoffs — `knowledge/ckd-stages.md`

Verify every boundary value and the stage it maps to (source: KDIGO, NIDDK):

| Stage | eGFR cutoff (mL/min/1.73m²) | Description in text |
|-------|-----------------------------|---------------------|
| Stage 1 | 90 or higher | normal filtering, with signs of damage |
| Stage 2 | 60–89 | mildly reduced filtering, with signs of damage |
| Stage 3 (3a/3b) | 30–59 | mild-to-moderate loss; often first diagnosed here |
| Stage 4 | 15–29 | severely reduced; planning for failure treatment |
| Stage 5 | below 15 | kidney failure / end-stage; dialysis or transplant |

Also confirm the accompanying statement that **albumin in the urine** raises
the risk of progression, and that **only a doctor using lab tests** can
determine a stage.

## 2. The CKD definition (3-month / GFR-60 rule) — `knowledge/ckd-basics.md`

Verify the KDIGO definition as written: CKD = kidneys damaged or filtering
poorly **for 3 months or longer**, i.e. **reduced kidney function, GFR below
60 mL/min/1.73m², or markers of kidney damage**. Confirm the 3-month duration,
the GFR-60 threshold, and the units.

## 3. Age risk thresholds — `knowledge/screening-and-scored.md`

Verify the age-related risk statement (source: SCORED; Bang et al., 2007):
risk **rises from age 50** and is **higher at 60 and 70+**. Confirm these
three thresholds (50 / 60 / 70+) are stated correctly for the screening
population.

## 4. SCORED accuracy statistics — `knowledge/screening-and-scored.md`

Verify all population-level accuracy figures at the **cutoff score of 4**
(source: SCORED; Bang et al., 2007):

- **Sensitivity ≈ 92%** — correctly flags ~92% of people with truly reduced
  kidney function.
- **Specificity ≈ 68%** — ~68% of people without it are correctly not flagged.
- **PPV 18%** — about 1 in 5 Screen Positive people actually have reduced
  kidney function.
- **NPV ≈ 99%** — a negative screen is correct about 99% of the time.
- **Cutoff = 4** — a total score of 4 or more is "Screen Positive"; 0–3 is
  "Screen Negative".

Confirm these describe the *tool at a population level*, not any individual,
and that the "Screen Positive ≠ has kidney disease" framing is preserved.

## 5. Unattributed sections (NO inline citation in the source) — FLAGGED

These two sections carry **no inline source citation** in the original
`knowledge-base.ts`. No source was invented. Each was given the most
defensible whitelist ID only to satisfy the DB `source` CHECK constraint, and
is flagged here for the adviser to confirm the attribution or exclude the
section from ingestion.

- **"What to do after screening"** — `knowledge/screening-and-scored.md`.
  Assigned `source: NIDDK` (falls back to the file's front-matter source;
  the confirmatory serum-creatinine/GFR and urine-albumin follow-up guidance
  is NIDDK/KDIGO patient education). `citations` front-matter does not list it
  because the text cites nothing inline. **Adviser: confirm NIDDK or reassign.**
- **"Hard boundaries for BATO's assistants"** — `knowledge/safety-boundaries.md`.
  This is BATO's own operational/scope policy (not-a-diagnostic-tool, no
  treatment/dosage advice, emergency-symptom escalation), not sourced clinical
  fact. Assigned `source: NIDDK` with an empty `citations` list and an inline
  HTML-comment flag in the file. **Adviser: confirm NIDDK, reassign, or decide
  this policy text should live only in prompts.ts and NOT be ingested as a
  retrievable chunk.**

## 6. Diet section is fully qualitative — `knowledge/diet-and-lifestyle.md`

The diet/lifestyle content (`Food, drink, and CKD`, `Living with CKD`,
`Keeping kidneys healthy`) contains **no numeric thresholds** — no gram
limits, no fluid volumes, no potassium/phosphorus targets. It is entirely
qualitative ("less salt", "may be advised on how much protein", "limits are
individual — no one should restrict these on their own"). This is stated
explicitly so the adviser knows there are no diet numbers to verify; the only
diet-review point is that it stays qualitative and defers quantitative limits
to a doctor or dietitian.

## 7. Epidemiological figures — `knowledge/statistics-and-burden.md` and `knowledge/kidney-health-philippines.md` (NEW, 2026-08-06)

Added because live testing showed BATO could not answer "how many people
died from kidney disease?" — the corpus held no numeric burden data at all.
Every figure below was taken from an already-approved source; none is
invented, and no new source was introduced.

| Claim | Figure | Source as cited | File | Confidence |
|-------|--------|-----------------|------|------------|
| Global rank of kidney disease as a cause of death | 19th (2000) → 9th (2021) | WHO, *The top 10 causes of death* fact sheet (Global Health Estimates) | statistics-and-burden | High — named WHO publication |
| Rise in global kidney disease deaths | ≈ **95%** increase, 2000–2021 | WHO, same fact sheet | statistics-and-burden | High — same |
| PH kidney failure incidence | ≈ **1 Filipino per hour**, ≈ **120 new cases per million per year** | PSN, World Kidney Day statement, March 2024, citing NKTI | kidney-health-philippines | High — PSN's own site |
| **PH deaths from kidney disease** | ≈ **39,000 per year** | DOH — see attribution note below | kidney-health-philippines | **Medium — VERIFY FIRST** |
| **PH dialysis patients** | **> 64,000** in 2024 | DOH — see attribution note below | kidney-health-philippines | **Medium — VERIFY FIRST** |

The split across two files is deliberate and load-bearing. A chunk's stored
`source` comes from its file's front-matter (see the corrected method note
at the end of this document), so Philippine figures live in the `DOH`-fronted
file and global figures in the `WHO`-fronted one. Putting them together
would have stored DOH and PSN figures under `WHO` — a false provenance
record. **Do not merge these sections back into one file.**

**Attribution note on the two DOH figures — the adviser must resolve this.**
Both come from a Philippine Information Agency report (pia.gov.ph, 2 June
2026) covering the DOH's National Kidney Month launch, at which Health
Secretary Ted Herbosa spoke and NKTI officials were present. PIA is the
government's official news agency and the event was DOH's, so `DOH` is the
defensible attribution — but the figures are **not individually attributed
inside the article**, and they were not confirmed against a primary DOH
publication, because psa.gov.ph and several PH government hosts were
unreachable during preparation. Adviser: confirm both against a primary DOH
release (or the PSA series, now that PSA is approved — see §8) and either
firm up the citation or pull the figures.

Adviser: also confirm the WHO rank/percentage still match the current Global
Health Estimates release at submission time. These are the corpus's only
epidemiological numbers, and they age faster than any other content in
`knowledge/` — the currency rule matters most here.

Confirm too the deliberate **absences**, which are as much an editorial
decision as the figures:

- **No single global death total** is quoted. Widely circulated figures
  (≈1.5 million deaths) come from the Global Burden of Disease study, not
  from an approved source, and revise with each release.
- **No national mortality rank** ("Nth leading cause of death in the
  Philippines") is quoted. Secondary sources variously say 7th, 9th and
  10th, depending on year and on whether the ICD group or CKD is meant.
  The corpus says only "consistently among the leading causes".
- **No CKD prevalence percentage** is quoted. Circulating Philippine
  estimates (e.g. 11.2% / ~12.94 million) appear in press coverage without
  traceable attribution and vary enormously between studies; none was
  confirmed to an approved source.
- The mortality section **states explicitly that 39,000 is an estimate and
  an undercount** (CKD deaths coded to cardiovascular or diabetic primary
  causes fall outside it). That caveat is load-bearing, not padding — it is
  the same caveat §8 requires of any PSA figure, and it must survive any
  future edit to that section.

## 8. SOURCE ADMISSION — Philippine Statistics Authority (PSA)

**Status: APPROVED 2026-08-06. Registered and mirrored. NO PSA-cited content
in the corpus yet.**

PSA is the Philippine government's official vital-statistics authority and
the only authoritative publisher of registered-death counts by cause. It was
admitted to unblock the most common statistics question users actually ask
("how many Filipinos die of kidney disease?").

Register entry, as applied:

- `id`: `PSA`
- `name`: Philippine Statistics Authority
- `category`: `official_health_body` — a national government statistics
  agency, the same category as DOH
- `publication_year`: `NULL` — PSA publishes a new *Causes of Death in the
  Philippines* release every year; pinning one year in the register would go
  stale, so the year is stated in the chunk text that cites it (same
  treatment as DOH and WHO)
- `adviser_approved_on`: `2026-08-06`

Applied via `supabase/migrations/20260806000002_register_psa_source.sql` and
mirrored in `supabase/functions/_shared/sources.ts`.

**Why no PSA-cited content yet.** psa.gov.ph refused every request during
preparation (HTTP 403, and a TLS handshake failure on direct download), so
no PSA figure could be read from the primary release and none was written
into the corpus. Nothing was substituted from a secondary source in its
place. The two Philippine mortality figures now in the corpus are attributed
to **DOH**, not PSA, and carry their own verification flag in §7.

**To add PSA content later**, pull the figure from the relevant *Causes of
Death in the Philippines* release, add it to
`knowledge/statistics-and-burden.md` citing `(PSA, <year>)`, log it in §7
above, then re-run ingestion. No further register or code change is needed —
that is the point of the register.

**Mandatory caveat on any PSA figure.** PSA reports deaths by ICD cause
group — "nephritis, nephrotic syndrome and nephrosis" — which is **not** the
same population as "chronic kidney disease". It excludes CKD deaths coded to
a cardiovascular or diabetic primary cause, so a PSA figure is a floor, not
a total. Any PSA figure added must be worded with that caveat intact, or
BATO will overstate the precision of a number that is genuinely an
undercount. (The DOH mortality section already carries the equivalent
wording; reuse it.)

## 9. Structural change to `screening-and-scored.md` (2026-08-06) — NO facts changed

The nine SCORED risk factors were one H2 bullet list; they are now one H2
section **each**. No clinical claim was added, removed, or reworded beyond
turning each bullet into a standalone sentence (e.g. "**Anemia** — having
too few healthy red blood cells." became "Anemia means having too few
healthy red blood cells."). Every inline citation was preserved. The file
went from 4 chunks to 13; total content is 2930 chars vs 2968 before.

**Why**: one 1429-char chunk covering nine distinct terms diluted all of
them, so no single term retrieved strongly enough for the Clarification
Engine to answer. Measured before/after (top cosine, clarification scope):
peripheral vascular disease 0.569 → **0.791**, proteinuria 0.645 → 0.738,
anemia 0.622 → 0.718. Off-topic controls stayed at 0.489/0.494.

**Constraint for future edits**: these must stay `##`, not `###`.
`scripts/chunker.ts` only splits at H3 when a section exceeds 2500
characters, so demoting them to H3 would silently merge all nine back into
one chunk and undo the fix with no error. The file's front-matter carries
this warning too.

The adviser should re-read this file as a whole to confirm the nine
definitions still read correctly standing alone, since each is now retrieved
and shown to users without the surrounding list for context.

---

## Attribution method note (for the adviser)

- Each `knowledge/*.md` file's front-matter carries one `source` (the file's
  primary/most-authoritative whitelist ID, also the DB fallback for any chunk
  with no inline citation) and a `citations` list (every whitelist ID the
  text cites inline).
- **CORRECTED 2026-08-06.** This document previously stated that the
  ingestion script assigns each chunk's DB `source` from the first inline
  whitelist citation in the chunk text, falling back to front-matter. That
  is **not** what the code does. `scripts/chunker.ts` assigns **every** chunk
  in a file the file's front-matter `source`, unconditionally — inline
  citation tags are never parsed. The description was aspirational, not a
  record of behaviour.
- The practical consequence, which the adviser should understand when
  reading provenance: a file's front-matter `source` must be the correct
  attribution for **every** section in it, because a section citing a
  different body inline will still be *stored* under the front-matter one.
  The `citations` list documents which other bodies the text cites inline,
  and the generator cites per-fact from those inline tags, so what a user
  sees can legitimately differ from the row's stored `source`.
- Two pre-existing files carry this mismatch and are left as-is for the
  adviser to rule on: `screening-and-scored.md` (front-matter `NIDDK`,
  but the SCORED accuracy figures in §4 are cited inline to SCORED) and
  `treatment-dialysis-transplant.md` (front-matter `NIDDK`, with
  KDIGO/WHO/CDC-cited sentences). Neither is a new problem introduced by
  the 2026-08-06 additions; both are flagged now only because the corrected
  method note above makes them visible.
- Inline "(NIDDK, KDIGO)"-style tags were preserved in the text so the
  General CKD Chatbot's generator can still cite sources per fact.
