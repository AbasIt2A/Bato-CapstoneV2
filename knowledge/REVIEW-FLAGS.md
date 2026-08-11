# REVIEW FLAGS — clinical adviser sign-off required before ingestion

This document lists every clinically sensitive or unattributed item in the
`knowledge/**/*.md` files. A clinical adviser (and/or the manuscript sources)
MUST verify each item below before `scripts/ingest-knowledge-md.ts` is run.
Nothing in `knowledge/` has been embedded or ingested — this is a draft.

All content was converted verbatim (facts unchanged) from the already-vetted
`supabase/functions/_shared/knowledge-base.ts` and
`supabase/functions/_shared/rag-content.ts`. No new clinical content was
fetched or invented. The flags below are the numbers and boundaries that most
need a second clinical read because they drive what BATO tells users.

---

## 1. eGFR stage cutoffs — `knowledge/clinical-guidelines/kdigo/ckd-stages.md`

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

## 2. The CKD definition (3-month / GFR-60 rule) — `knowledge/official-health-body/niddk/ckd-basics.md`

Verify the KDIGO definition as written: CKD = kidneys damaged or filtering
poorly **for 3 months or longer**, i.e. **reduced kidney function, GFR below
60 mL/min/1.73m², or markers of kidney damage**. Confirm the 3-month duration,
the GFR-60 threshold, and the units.

## 3. Age risk thresholds — `knowledge/peer-reviewed/scored/scored-instrument.md`

Verify the age-related risk statement (source: SCORED; Bang et al., 2007):
risk **rises from age 50** and is **higher at 60 and 70+**. Confirm these
three thresholds (50 / 60 / 70+) are stated correctly for the screening
population.

## 4. SCORED accuracy statistics — `knowledge/peer-reviewed/scored/scored-instrument.md`

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

- **"What to do after screening"** — `knowledge/official-health-body/niddk/screening-and-risk-factors.md`.
  Assigned `source: NIDDK` (falls back to the file's front-matter source;
  the confirmatory serum-creatinine/GFR and urine-albumin follow-up guidance
  is NIDDK/KDIGO patient education). `citations` front-matter does not list it
  because the text cites nothing inline. **Adviser: confirm NIDDK or reassign.**
- **"Hard boundaries for BATO's assistants"** — `knowledge/official-health-body/niddk/safety-boundaries.md`.
  This is BATO's own operational/scope policy (not-a-diagnostic-tool, no
  treatment/dosage advice, emergency-symptom escalation), not sourced clinical
  fact. Assigned `source: NIDDK` with an empty `citations` list and an inline
  HTML-comment flag in the file. **Adviser: confirm NIDDK, reassign, or decide
  this policy text should live only in prompts.ts and NOT be ingested as a
  retrievable chunk.**

## 6. Diet section is fully qualitative — `knowledge/official-health-body/niddk/diet-and-lifestyle.md`

The diet/lifestyle content (`Food, drink, and CKD`, `Living with CKD`,
`Body weight and a healthy weight for your kidneys`, `Keeping kidneys
healthy`) contains **no numeric thresholds** — no gram limits, no fluid
volumes, no potassium/phosphorus targets, and no BMI cut-offs. It is entirely
qualitative ("less salt", "may be advised on how much protein", "limits are
individual — no one should restrict these on their own"). This is stated
explicitly so the adviser knows there are no diet numbers to verify; the only
diet-review point is that it stays qualitative and defers quantitative limits
to a doctor or dietitian.

**The weight section is NEW (2026-08-11) — VERIFY.** It was added because live
testing showed BATO deflecting "what is the healthy weight for a good kidney"
with its out-of-scope refusal. The gate admitted the question and pgvector
returned sensible candidates (cosine ~0.70), but nothing in the corpus
*answered* it: body weight appeared only as a passing clause inside two
lists — "keep a healthy weight" here and "Lose weight if it is needed" in
`official-health-body/cdc/ckd-basics-and-awareness.md` — so every candidate
scored below the rerank threshold (best 0.254 against 0.30) and the pipeline
deflected. The fix is corpus content, not a lowered threshold.

No new source was introduced; every claim traces to one already approved:

| Claim | Source as cited |
|---|---|
| No single healthy weight; BMI compares weight with height; a clinician determines an individual's healthy weight | NIDDK (*Preventing CKD*: "aiming for a healthy weight"); KDOQI 2020 §1.1.6, which leaves the method of assessing body weight to clinical judgement "due to absence of standard reference norms" |
| Obesity among the risk factors for CKD | CDC, *CKD Basics* — already carried in `cdc/ckd-basics-and-awareness.md` |
| Excess weight acts largely through diabetes and hypertension, the most common causes of kidney failure | CDC (stated there as a **United States** figure, 2 of 3 new cases; the numeric form is deliberately NOT repeated here) |
| Obesity associated with progression toward kidney failure in people with CKD | APSN 2025 DKD guideline, Clinical Recommendation 3.5 rationale: "obesity is associated with an increased risk of glomerulopathy and progression to KF in people with all forms of CKD" |
| Weight is monitored differently in advanced CKD/dialysis (unintentional loss signals poor nutrition; fluid distorts the reading) | KDOQI 2020 §1.1.5–1.1.9 |

Two review points for the adviser. First, the APSN and KDOQI claims are
**inline citations inside an NIDDK-fronted file**, so the stored chunk
`source` is `NIDDK` — the same pattern already used for the WHO/CDC/KDIGO
lines above, and both IDs are now listed in the file's `citations`
front-matter. Confirm that is acceptable, or move the two lines into their
own source-fronted files. Second, confirm the APSN progression claim is fair
to state for CKD generally: the guideline is about diabetic kidney disease,
but that specific sentence is written about "all forms of CKD".

## 7. Epidemiological figures — `knowledge/official-health-body/who/statistics-and-burden.md` and `knowledge/official-health-body/doh/kidney-health-philippines.md` (NEW, 2026-08-06)

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
`knowledge/official-health-body/who/statistics-and-burden.md` citing `(PSA, <year>)`, log it in §7
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

## 9. Structural change to the screening file (2026-08-06) — NO facts changed

> Path note: the file this section describes was `screening-and-scored.md`.
> It was split on 2026-08-11 into `screening-and-risk-factors.md` and
> `peer-reviewed/scored/scored-instrument.md` (see §11). The constraint below
> — one H2 per variable — applies to **both** halves.


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

## 10. Directory layout by inclusion-framework category (2026-08-08) — NO facts changed

The corpus was flat (`knowledge/*.md`); it is now filed by the inclusion
framework's three admissible categories, one folder per publishing body:

```
knowledge/
  official-health-body/
    cdc/      ckd-basics-and-awareness.md                        (§12)
    doh/      kidney-health-philippines.md
    niddk/    ckd-basics.md, diet-and-lifestyle.md,
              safety-boundaries.md, screening-and-risk-factors.md,
              symptoms-causes-complications.md,
              tests-and-diagnosis.md                             (§12)
              treatment-dialysis-transplant.md
    who/      kidney-health-policy.md                            (§12)
              statistics-and-burden.md
  clinical-guidelines/
    apsn/     diabetes-and-kidney-disease.md                     (§12)
    isn/      global-kidney-care-capacity.md                     (§12)
    kdigo/    ckd-definition-and-testing.md                      (§12)
              ckd-stages.md
    kdoqi/    nutrition-care-in-ckd.md                           (§12)
    nice/     who-should-be-tested.md                            (§12)
    psh/      high-blood-pressure-in-the-philippines.md          (§12)
  peer-reviewed/
    chen2019/ ckd-overview-for-primary-care.md                   (§12)
    phesrd/   esrd-care-in-the-philippines.md                    (§12)
    scored/   scored-instrument.md                               (§11)
  REVIEW-FLAGS.md
```

(Tree as of 2026-08-11. Entries marked §11/§12 postdate the 2026-08-08 move
this section describes; the rest is the original layout.)

Files moved only; no front-matter, heading, or body text was edited, so
chunk boundaries, stored `source` values and retrieval behaviour are
unchanged. `scripts/ingest-knowledge.ts` now walks `knowledge/` recursively
and reports each file by its path relative to `knowledge/`.

**The path is documentation, not provenance.** A chunk's stored `source`
still comes from its file's front-matter alone — the folder is never read.
The two are expected to agree, and where they disagree the front-matter
wins silently, so a misfiled document is only caught by a human reading the
front-matter. The folder placement follows each file's front-matter
`source`, and the category folder follows that source's `category` in
`supabase/functions/_shared/sources.ts`.

Consequences the adviser should note:

- `psn/` has no folder because no file is fronted by PSN — the PSN-cited
  incidence figures live in the DOH-fronted `kidney-health-philippines.md`
  (§7 explains why that split is load-bearing).
- `peer-reviewed/` was empty at the time of the move, because the SCORED
  sections still sat in a `NIDDK`-fronted file. **Resolved 2026-08-11 — see
  §11**; `peer-reviewed/scored/scored-instrument.md` now holds them.
- Git does not track empty directories, so `peer-reviewed/` exists only once
  a file is placed in it.
- PHESRD and CHEN2019 were curated into `peer-reviewed/` on 2026-08-11 (§12).
  **PHCOI and GBD remain uncurated — both are paywalled and were never
  fetched**; see §12.1.

## 11. SCORED split into a `peer-reviewed/` file (2026-08-11) — NEW CONTENT, VERIFY

`knowledge/official-health-body/niddk/screening-and-scored.md` was one file
carrying two different provenances: NIDDK/CDC/KDIGO patient education about
kidney risk factors, **and** the SCORED instrument's own findings. Because a
chunk's stored `source` is its file's front-matter value unconditionally (see
the method note below), every SCORED figure in it was being stored as
**`NIDDK`** — a false provenance record for a peer-reviewed instrument, and
the reason `peer-reviewed/` stood empty while its flagship source sat
misfiled. This is the resolution §10 anticipated.

The file is now two:

| File | Front-matter `source` | Holds |
|---|---|---|
| `official-health-body/niddk/screening-and-risk-factors.md` | `NIDDK` | Why screening matters; the **seven condition variables** (anemia, hypertension, diabetes, CVD, heart failure, PVD, proteinuria); what to do after screening |
| `peer-reviewed/scored/scored-instrument.md` | `SCORED` | What SCORED is; the nine-variable list; **point weights**; **age** and **sex**; Screen Positive / Screen Negative; **accuracy figures**; limitations |

Both stay dual-scoped (`general_education`, `screening_clarification`) and
both keep one H2 per variable, so §9's constraint and the clarification
retrieval margins are unaffected — the seven condition sections, "Why
screening matters", "What to do after screening", "Older age and kidney
risk" and "Female sex and kidney risk" were moved **verbatim**, and only
`content` is embedded, so their vectors are byte-identical to the measured
ones in `scopes.ts`.

**Carried over unchanged, already flagged above:** the age thresholds (§3)
and the cutoff-4 accuracy figures — sensitivity 92%, specificity 68%, PPV
18%, NPV 99% (§4). Those two sections now point at the new path.

**NEW content the adviser has not seen before.** All of it was read from the
primary paper (`scraped/clean/scored-bang-2007.md`, Tables 2 and 3 and Figure
2); nothing was inferred, and no new source was introduced. Verify each:

| Claim | As written | Paper location |
|---|---|---|
| Development sample | 8,530 adults, US NHANES 1999–2002 | Abstract |
| External validation | Atherosclerosis Risk in Communities study | Abstract |
| CKD definition used by the study | eGFR < 60 mL/min/1.73m² | Abstract; Table 2 footnote |
| Age point weights | 50–59 → **2**, 60–69 → **3**, ≥70 → **4**, <50 → **0** | Table 2; Figure 2 |
| All eight other variables | **1** point each | Table 2; Figure 2 |
| Total range | **0–12** | Derived by summation (4 + 8×1) |
| Unsure answers | score **zero** | Figure 2 instruction line |
| Alternative cutoff of 6 | sensitivity **68%**, specificity **87%** | Table 3 |
| Re-screening interval | about once a year | Figure 2, "If You Scored 0–3 Points" |
| Limitations | weighted to common risk factors; flags a high proportion of over-70s; not designed for polycystic kidney disease or glomerulonephritis; asks nothing about hematuria or family history | LIMITATIONS section |

Two deliberate **omissions**, for the adviser to confirm rather than restore:

- **The AUC figures** (0.88 internal, 0.71 external) are not in the corpus.
  They are a discrimination statistic for a modelling audience and cannot be
  read correctly by a layperson beside the sensitivity/specificity numbers,
  which say the same thing in a form users can act on.
- **The regression equation** in the published erratum is not in the corpus.
  BATO never computes a probability — `supabase/functions/_shared/scored.ts`
  implements the integer scoring rule only — so carrying the formula would
  invite the generator to describe arithmetic the system does not perform.

**Cross-check performed.** The point weights above were verified against
`supabase/functions/_shared/scored.ts` (`agePoints`, `binaryPoints`,
`SCREEN_POSITIVE_CUTOFF`, `MAX_SCORE = 12`) and match exactly. If the adviser
corrects a weight here, that module and its tests must change with it — the
corpus and the scorer must never disagree about what a user's score means.

## 12. Top-20 curation — eleven new files (2026-08-11) — ALL NEW, VERIFY

The corpus previously drew on 5 of the 20 sources in [SOURCES.md](../SOURCES.md).
This section covers the curation of the remaining non-paywalled ones into
their inclusion-framework folders. Every file was written from the primary
text in `scraped/clean/*.md`; nothing was fetched afresh, inferred, or taken
from a secondary source, and no new source ID was introduced — all eleven
front-matter `source` values were already registered on 2026-08-10.

| New file | Source | SOURCES.md # | Scopes |
|---|---|---|---|
| `knowledge/official-health-body/cdc/ckd-basics-and-awareness.md` | CDC | 4, 5, 14 | general |
| `knowledge/official-health-body/niddk/tests-and-diagnosis.md` | NIDDK | 3, 7 | both |
| `knowledge/official-health-body/who/kidney-health-policy.md` | WHO | 8, 17 | general |
| `knowledge/clinical-guidelines/kdigo/ckd-definition-and-testing.md` | KDIGO | 1 | both |
| `knowledge/clinical-guidelines/nice/who-should-be-tested.md` | NICE | 11 | general |
| `knowledge/clinical-guidelines/kdoqi/nutrition-care-in-ckd.md` | KDOQI | 13 | general |
| `knowledge/clinical-guidelines/isn/global-kidney-care-capacity.md` | ISN | 18 | general |
| `knowledge/clinical-guidelines/apsn/diabetes-and-kidney-disease.md` | APSN | 19 | general |
| `knowledge/clinical-guidelines/psh/high-blood-pressure-in-the-philippines.md` | PSH | 20 | **both** |
| `knowledge/peer-reviewed/chen2019/ckd-overview-for-primary-care.md` | CHEN2019 | 16 | general |
| `knowledge/peer-reviewed/phesrd/esrd-care-in-the-philippines.md` | PHESRD | 15 | general |

SOURCES.md #2, #6 and #12 needed no new file: #2 and #12 are NIDDK pages whose
substance is already in `niddk/ckd-basics.md` and
`niddk/symptoms-causes-complications.md`, and #6 is SCORED, curated in §11.

### 12.1 Two sources NOT curated — paywalled

**PHCOI** (#9, Cost-of-Illness Analysis of CKD in the Philippines, *Journal of
Medical Economics* 2025) and **GBD** (#10, Global Burden of Disease 2023 CKD,
*The Lancet* 2025) have **no file and no scraped text**. Both sit behind
publisher paywalls and were never successfully fetched — `scraped/raw/` has no
entry for either. Nothing was substituted from a secondary source or from
press coverage in their place.

Both remain registered in `public.knowledge_sources`, so nothing needs to
change to admit them later — obtain the full texts (institutional access, or
the Lancet article's CC BY 4.0 version) and curate them the same way.

Their absence has a cost the adviser should weigh: **PHCOI was the intended
home of the strongest Philippine burden figures**, which is why §7's gaps —
no traceable Philippine prevalence, no verified national mortality rank —
are still open.

### 12.2 Editorial rules applied throughout

Four constraints already binding on this corpus were applied to every file,
and each one caused specific material to be excluded:

1. **No treatment, no medicines, no dosages** (`safety-boundaries.md`). Removed
   the drug classes from CDC's risk-reduction list, KDOQI's per-kilogram
   protein prescriptions, PSH's blood-pressure targets and drug tables, APSN's
   therapy chapters, and Chen et al.'s management and drug-dosing sections.
2. **Diet content stays qualitative** (§6). KDOQI's numeric targets —
   0.55–0.60 g protein/kg/day and the rest — are all excluded. The KDOQI file
   instead documents *why* those numbers cannot be self-applied, which is what
   makes it useful to a chatbot that must not state them.
3. **No untraceable prevalence figures** (§7). See §12.3.
4. **Foreign statistics are labelled as foreign.** Every CDC figure is US data
   and is worded that way in the text; a US prevalence read as a Philippine one
   would be a plain factual error for BATO's main audience.

### 12.3 Deliberate omissions the adviser should confirm rather than restore

- **Philippine CKD prevalence of 35.94%** (PHESRD opening paragraph, citing a
  secondary reference). Excluded. It is about three times the global figure
  quoted in the same sentence (9.1%–13.4%), and §7 already bars unverified
  Philippine prevalence percentages. Reachable only through a citation hop.
- **NICE recommendation 1.1.24** — do not use age, sex, ethnicity or obesity
  alone as the trigger for CKD testing. Correct in its own context (rationing
  NHS lab tests), but it would live in the same corpus as SCORED's age and sex
  sections, which score exactly those variables. Retrieved alongside them it
  reads as the corpus contradicting BATO's own instrument, on the screen where
  the user is answering those very questions.
- **Chen et al.'s APOL1 and sickle-cell-trait genetics.** US ancestry-group
  epidemiology; presenting it to a Philippine audience invites a reader to draw
  a conclusion about their own risk that the data does not support.
- **KDIGO's G1–G5 eGFR bands**, in the new KDIGO file. Not an exclusion on
  substance — `kdigo/ckd-stages.md` already holds them (§1), and duplicating
  them would create two competing chunks and two verification burdens.

### 12.4 New clinical figures requiring verification

Every figure below is new to the corpus. All were read from the primary text;
none is calculated, converted or inferred.

| Claim | Figure | File | Source location |
|---|---|---|---|
| Global CKD prevalence | **674 million**, ~**9%** of world population | who/kidney-health-policy | WHA78.6 preamble |
| Projected rank by 2050 | **5th** leading cause of death; **+33%** death rate | who/kidney-health-policy | WHA78.6 preamble |
| CKD with hypertension / diabetes | **1 in 5** / **4 in 10**; **1 in 10** hypertension deaths | who/kidney-health-policy | WHA78.6 preamble |
| Hypertensive disorders of pregnancy | ~**1 in 10** pregnancies | who/kidney-health-policy | WHA78.6 preamble |
| US CKD prevalence / unawareness | **1 in 7** adults; **9 in 10** unaware; **35.5M**; **40%** unaware at severe stages | cdc/ckd-basics-and-awareness | CDC Basics, "CKD by the numbers" |
| US dialysis starts; cause share | **360**/day; **2 of 3** new cases from diabetes + hypertension | cdc/ckd-basics-and-awareness | CDC Basics |
| BP target quoted in CDC advice | **140/90 mm Hg** | cdc/ckd-basics-and-awareness | CDC "Reducing risk" |
| GFR interpretation | ≥**60** normal; <**60** may mean CKD; ≤**15** kidney failure | niddk/tests-and-diagnosis | NIDDK Tests & Diagnosis |
| Urine albumin threshold | ≤**30 mg/g** normal; >**30 mg/g** may indicate CKD | niddk/tests-and-diagnosis | NIDDK Tests & Diagnosis; Quick Reference |
| CKD criteria | ACR ≥**30 mg/g** or GFR <**60**, for ≥**3 months** | kdigo/ckd-definition-and-testing | KDIGO 2024 Table 1 |
| Albuminuria categories | A1 <30 / A2 30–300 / A3 >300 mg/g | kdigo/ckd-definition-and-testing | KDIGO 2024 Table 3 |
| Confirmation interval | repeat eGFR <60 within **2 weeks**; creatinine varies ±**5%** | nice/who-should-be-tested | NG203 rec. 1.1.8 |
| Clinically important proteinuria | ACR ≥**3 mg/mmol** | nice/who-should-be-tested | NG203 rec. 1.1.13 |
| Public funding for KRT | HD **63%**, PD **55%**, transplant **59%**; **37%** fully out-of-pocket | isn/global-kidney-care-capacity | GKHA 2023 exec. summary |
| Nephrologist density | median **11.75 pmp**; **80-fold** HIC:LIC gap; **9.5→12.4 pmp** 2019–2023 | isn/global-kidney-care-capacity | GKHA 2023 exec. summary |
| Asia-Pacific DKD albuminuria | moderate **17.0–18.2%**; severe **2.1–14.4%**; reduced eGFR **15.3–61.6%** | apsn/diabetes-and-kidney-disease | APSN §2 |
| DKD screening interval | annual; from **5 years** after type 1 dx, from dx for type 2 | apsn/diabetes-and-kidney-disease | APSN CR1.2 |
| DKD vs non-diabetic disease on biopsy | **7–94%** vs **3–83%** | apsn/diabetes-and-kidney-disease | APSN §4.2.6 |
| **PH hypertension definition** | **≥140/90 mmHg** | psh/high-blood-pressure-in-the-philippines | PSH 2020 §definition |
| Global CKD prevalence (review) | **8–16%**; **<5%** of early CKD aware; **16th** cause of YLL | chen2019/ckd-overview-for-primary-care | JAMA 2019 abstract |
| Nephrology referral thresholds | eGFR <**30**; ACR >**300 mg**/24h | chen2019/ckd-overview-for-primary-care | JAMA 2019, Referral |
| PH modality split | HD **94%**, PD **4%**, transplant **2%** | phesrd/esrd-care-in-the-philippines | Pajimna 2023 ¶1 |
| PhilHealth HD sessions | **156**/yr from **June 2023** (was 45/90/144 in 2013/2015/2020) | phesrd/esrd-care-in-the-philippines | Pajimna 2023 ¶2 |
| PD-First package | **2014**; **90–120** solutions/month; **3** bags/day in practice | phesrd/esrd-care-in-the-philippines | Pajimna 2023 ¶5 |
| PhilHealth coverage gap | **52%** or below in some remote provinces, 2018–2021 | phesrd/esrd-care-in-the-philippines | Pajimna 2023 ¶2 |

### 12.5 Two figures that need a currency check

- **The PSH hypertension threshold (≥140/90) is the single highest-stakes
  number in this batch**, because it is dual-scoped and will be retrieved
  mid-assessment while a user decides how to answer the SCORED high-blood-
  pressure question. It is deliberately NOT the AHA/ACC 130/80, and the file
  explains why. Confirm the 2020 guideline is still the current Philippine
  edition; if a newer one changes the threshold, this file must change the
  same day.
- **PhilHealth session counts change by policy.** The June 2023 figure was
  current as of the 2023 article. The text dates every figure and tells the
  reader to confirm with PhilHealth, but a stale number here is the kind a
  user may act on.

### 12.6 Retrieval impact

The corpus goes from 10 files / 39 chunks to **21 files / 121 chunks**, which
is a larger change to the retrieval landscape than any previous addition. Two
consequences to watch when the thresholds in `scopes.ts` are next measured:

- Only three new files enter `screening_clarification`:
  `niddk/tests-and-diagnosis.md`, `kdigo/ckd-definition-and-testing.md` and
  `psh/high-blood-pressure-in-the-philippines.md`. That scope's floors
  were set against a nine-term corpus (§9), so **the per-term cosines in
  `scopes.ts` should be re-measured before the next ingestion**, particularly
  for "high blood pressure", which now has a second strong chunk.
- The remaining eight files are `general_education` only and cannot affect the
  clarification path at all.

---

## Attribution method note (for the adviser)

- Each `knowledge/**/*.md` file's front-matter carries one `source` (the file's
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
- Two pre-existing files carried this mismatch. The first,
  `screening-and-scored.md` (front-matter `NIDDK`, but the SCORED accuracy
  figures in §4 cited inline to SCORED), was **resolved on 2026-08-11 by the
  split in §11** — those sections now sit in a `SCORED`-fronted file. The
  second, `treatment-dialysis-transplant.md` (front-matter `NIDDK`, with
  KDIGO/WHO/CDC-cited sentences), is **still open** for the adviser to rule
  on. Neither was introduced by the 2026-08-06 additions; both were flagged
  only because the corrected method note above made them visible.
- Inline "(NIDDK, KDIGO)"-style tags were preserved in the text so the
  General CKD Chatbot's generator can still cite sources per fact.
