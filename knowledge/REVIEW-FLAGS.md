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

---

## Attribution method note (for the adviser)

- Each `knowledge/*.md` file's front-matter carries one `source` (the file's
  primary/most-authoritative whitelist ID, also the DB fallback for any chunk
  with no inline citation) and a `citations` list (every whitelist ID the
  text cites inline).
- The ingestion script assigns each chunk's DB `source` from the **first
  inline whitelist citation** in that chunk's text, falling back to the
  front-matter `source` when the text cites none. That fallback is exactly
  what happens for the two flagged, unattributed sections above.
- Inline "(NIDDK, KDIGO)"-style tags were preserved in the text so the
  General CKD Chatbot's generator can still cite sources per fact.
