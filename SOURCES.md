# BATO — RAG Knowledge Base Sources

Every source the corpus draws on, in one place: the twenty originally selected,
the sources that were already registered and cited before that list existed, and
the sources queued for the next curation pass. A source appears here whether or
not it has content in `public.knowledge_chunks` yet — the section it sits in says
which.

**The numbering is load-bearing.** Rows #1–#20 are cross-referenced by number from
the front matter of `knowledge/**/*.md`, from `knowledge/REVIEW-FLAGS.md`, from
`scripts/scrape/manifest.ts` and from
`supabase/migrations/20260810145929_register_top20_sources.sql`. Never renumber
them; new sources append from #21.

**Admission is not the same as listing.** A row here is a justification, not an
approval. Content only reaches the corpus once the source has a row in
`public.knowledge_sources` with an adviser sign-off date and a mirror entry in
`supabase/functions/_shared/sources.ts` — see the inclusion framework in
`20260806000001_source_register_and_scopes.sql`.

---

## Top 20 selected sources (#1–#20)

Eighteen were scraped into `scraped/raw/` and curated into `knowledge/`. Two —
#9 and #10 — were never fetched and have no chunks: Taylor & Francis paywalls the
first and the Lancet page renders as an advertising shell. Their register rows
were removed rather than left empty; `scripts/scrape/manifest.ts` records the
observed failure.

| # | Source | Why it earns a slot | URL |
|---|---|---|---|
| 1 | KDIGO 2024 CKD Guideline (PDF) | Definitional spine. Every "what is CKD / what is eGFR / what is albuminuria" answer should trace here. | https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf |
| 2 | NIDDK — What Is CKD in Adults? | Best plain-language lay register of any source in this list. | https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/what-is-chronic-kidney-disease |
| 3 | NIDDK — CKD Tests & Diagnosis | Directly answers post-screening "what happens next" questions. | https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/tests-diagnosis |
| 4 | CDC — Chronic Kidney Disease Basics | Short, chunk-friendly, public-domain, layperson-pitched. | https://www.cdc.gov/kidney-disease/about/index.html |
| 5 | CDC — CKD: Common, Serious, and Costly | Awareness framing ("most don't know they have it") — core to BATO's premise. | https://www.cdc.gov/kidney-disease/ckd-facts/index.html |
| 6 | Bang et al. 2007 — SCORED | Your instrument of record. Must sit in `scored_clarification` scope. | Project files (`SCORED.pdf`); Arch Intern Med. 2007;167(4):374–381 |
| 7 | NIDDK — Quick Reference on UACR & GFR | Precise, compact definitions for the two key CKD markers. | https://www.niddk.nih.gov/health-information/professionals/advanced-search/quick-reference-uacr-gfr |
| 8 | WHO — Resolution WHA78.6 on Kidney Health | Authoritative policy anchor; supports "why screening matters" framing. | https://apps.who.int/gb/ebwha/pdf_files/WHA78/A78_R6-en.pdf |
| 9 | Cost-of-illness analysis of CKD in the Philippines | Strongest recent peer-reviewed Philippine burden figures. **Never fetched — paywalled; no chunks, no register row.** | https://www.tandfonline.com/doi/full/10.1080/13696998.2025.2481766 |
| 10 | GBD 2023 CKD (Lancet, 2025) | Current global burden numbers; CC BY 4.0. **Never fetched — article never renders; no chunks, no register row.** | https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(25)01853-7/fulltext |
| 11 | NICE NG203 (full guidance PDF) | Excellent on *who should be tested* and on jargon-free risk communication. | https://www.nice.org.uk/guidance/ng203/resources/chronic-kidney-disease-assessment-and-management-pdf-66143713055173 |
| 12 | NIDDK — CKD hub page | Risk-factor enumeration that maps cleanly to the SCORED variables. | https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd |
| 13 | KDOQI Nutrition in CKD: 2020 Update (PDF) | The authoritative answer for the diet questions users will actually ask. | https://www.ajkd.org/article/s0272-6386(20)30726-5/pdf |
| 14 | CDC — CKD Initiative hub | Prevention and "caring for yourself" content. | https://www.cdc.gov/kidney-disease/index.html |
| 15 | Gaps and challenges in ESRD treatment: Philippines | Local care pathway, PhilHealth, dialysis access context. | https://pmc.ncbi.nlm.nih.gov/articles/PMC10544423/ |
| 16 | Chen, Knicely & Grams — JAMA 2019 review | Best single-article synthesis for intermediate-depth answers. | https://pmc.ncbi.nlm.nih.gov/articles/PMC7015670/ |
| 17 | WHO PEN for Primary Health Care (2020) | Aligns BATO with the framework PhilPEN localizes. | https://qualityhealthservices.who.int/quality-toolkit/qt-catalog-item/who-package-of-essential-noncommunicable-(-pen)-disease-interventions-for-primary-health-care |
| 18 | ISN–Global Kidney Health Atlas 2023 (full PDF) | Regional / Western Pacific care-capacity context. | https://www.theisn.org/wp-content/uploads/media/ISN%20Atlas_2023%20Digital_REV_2023_10_03.pdf |
| 19 | APSN Diabetic Kidney Disease — 2025 Update | Asia-Pacific-specific; diabetes is a top SCORED variable. | https://onlinelibrary.wiley.com/doi/10.1111/nep.70030 |
| 20 | 2020 Philippine Hypertension CPG (full PDF) | Local BP guidance; hypertension is the other top SCORED variable. | https://www.philippinesocietyofhypertension.org.ph/ClinicalPracticeGuidelines.pdf |

---

## Foundation sources — registered and cited before the Top 20 existed (#21–#25)

These predate the Top-20 list, so they never had rows in it — but four of the
five are already in `public.knowledge_sources` and two carry live corpus content.
They belong here because the corpus cites them today and the manuscript's source
register has to account for every one.

| # | Source | Why it earns a slot | URL |
|---|---|---|---|
| 21 | DOH (Philippines) — National Kidney Month launch, reported by PIA, 2 June 2026 | The corpus's only Philippine mortality and dialysis-population figures (≈39,000 deaths/yr; >64,000 on dialysis in 2024), carried in `doh/kidney-health-philippines.md`. **Registered and ingested, but flagged: the figures are not individually attributed inside the article and were never confirmed against a primary DOH release — REVIEW-FLAGS §7 requires the adviser to firm up or pull them.** | https://pia.gov.ph/news/1-filipino-develops-chronic-kidney-disease-every-hour-says-health-expert/ |
| 22 | Philippine Society of Nephrology — World Kidney Day statement, March 2024 | Source of the kidney-failure incidence figures (≈1 Filipino per hour, ≈120 new cases per million per year, citing NKTI). Registered since 2026-07-08; **no chunk is fronted by PSN** — the figures live inside the DOH-fronted file and cite PSN inline, which is why `knowledge/` has no `psn/` folder. | https://psn.org.ph/2024/03/01/rising-incidence-of-chronic-kidney-disease-in-the-philippines-sparks-call-for-kidney-health-awareness-subtitle-the-philippine-society-of-nephrology-urges-filipinos-to-take-proactive-measures/ |
| 23 | AstraZeneca Philippines — SCORED patient questionnaire card | The licensed Philippine publication of the instrument BATO administers (AMA licence 5263480664527, 7 Mar 2022; Veeva PH-6850). It is the authority for the card's own "answer zero when uncertain" rule, enforced in `_shared/scopes.ts` and `_shared/questions.ts`. **Registered 2026-07-08; no corpus content — the card is a licensed print asset, not a fetchable page.** | Project files (licensed card, no public URL) |
| 24 | Philippine Statistics Authority — Causes of Death in the Philippines | The only authoritative publisher of Philippine registered-death counts by cause; admitted to unblock "how many Filipinos die of kidney disease?". **Registered 2026-08-06; still no content — psa.gov.ph returned 403 on every request during preparation.** Any figure taken from it must carry the REVIEW-FLAGS §8 caveat: PSA reports the ICD group "nephritis, nephrotic syndrome and nephrosis", which is a floor for CKD deaths, not a total. | https://psa.gov.ph/statistics/vital-statistics/index |
| 25 | WHO — The top 10 causes of death (Global Health Estimates) | Source of the only global mortality claims in the corpus (kidney disease 19th in 2000 → 9th in 2021; deaths up ≈95%), carried in `who/statistics-and-burden.md`. Registered under the existing `WHO` ID and ingested. Ages faster than anything else in `knowledge/` — re-verify at submission. | https://www.who.int/news-room/fact-sheets/detail/the-top-10-causes-of-death |

---

## Services, cost, food and drink — ingested 2026-08-30 (#26–#30)

Selected against the gap audit in [docs/corpus-blind-spots.md](docs/corpus-blind-spots.md),
which ranks Philippine cost/access content first and named Filipino food and
drink second.

**All five are now scraped, curated and ingested.** Four new publishers were
registered in `20260830000001_register_services_and_diet_sources.sql`
(`DAVAOCHO`, `PHILHEALTH`, `DDH`, `NKF`); NIDDK needed no new row. The corpus
went from 122 chunks across 13 sources to **150 chunks across 17 sources**.
Curation decisions, the numbers carried and the numbers stripped, and the
outstanding adviser questions are logged in
[REVIEW-FLAGS.md §13](knowledge/REVIEW-FLAGS.md).

⚠️ **Two things the adviser must rule on**, both recorded in §13: the four
`adviser_approved_on` dates record developer admission, not a sign-off meeting;
and `DDH` (#27) is a private hospital tariff that fits none of the three
inclusion categories cleanly.

| # | Source | Why it earns a slot | URL |
|---|---|---|---|
| 26 | Davao City CHO — Early consultation vital vs kidney diseases (City Government of Davao, 19 June 2026) | The only local-services source in the whole list, and the answer to the single most damaging gap for a Davao-based capstone: "where do I go?" Names the free district-health-centre consultation and the tests actually offered there (creatinine, urinalysis, CBC, cholesterol, uric acid). Admissible as an LGU health office under `official_health_body`. | https://davaocity.gov.ph/health/early-consultation-vital-vs-kidney-diseases-says-cho |
| 27 | Davao Doctors Hospital — Laboratory price list (24 Mar 2025, PDF) | The only peso figures available to the corpus: creatinine ₱354, urinalysis ₱61–200, microalbumin/creatinine ratio ₱750. Answers "magkano ang creatinine test?", which currently returns nothing. **Admission question for the adviser: a private hospital price list fits none of the three inclusion categories cleanly** — it is neither an official health body, a clinical guideline, nor peer-reviewed literature. If admitted, prices need a stated as-of date and a "check with the facility" caveat, since they go stale faster than any clinical content. | https://ddh.com.ph/wp-content/uploads/2023/09/DDH-Laboratory-List-3.24.25.pdf |
| 28 | PhilHealth — Benefit packages | Turns PHESRD's dialysis *session counts* into what a user actually needs: the hemodialysis case rate (₱6,350/session, 90-day annual limit), peritoneal dialysis packages, and kidney transplant under Z Benefits. Government corporation, so `official_health_body`. Note the page does **not** cover Konsulta — the outpatient screening question stays open and needs a separate circular. | https://www.philhealth.gov.ph/benefits |
| 29 | NIDDK — Healthy Eating for Adults with CKD | The corpus's diet content is four qualitative chunks that name no food at all. This names food groups, cooking methods and what to limit, from an already-registered source. **Carries per-day sodium figures. REVIEW-FLAGS §6 excludes individualized quantitative lifestyle management, and flags a general per-day nutrient figure as the borderline case needing adviser sign-off — excluded by default. Curation strips them exactly as KDOQI's per-kilogram figures were stripped.** | https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease |
| 30 | National Kidney Foundation — Healthy hydration for your kidneys | The corpus has zero hits for coffee, soda, energy drinks or alcohol, and every one of those is a high-frequency question. This names drinks to favour and to limit without prescribing a fluid target, which keeps the standing no-numeric-threshold rule intact. NKF is already in the register as the publisher behind `KDOQI` (#13); admitting consumer content under that ID, or opening a separate `NKF` ID, is an adviser call. | https://www.kidney.org/news-stories/healthy-hydration-your-kidneys-what-to-sip-and-what-to-skip |

**Already listed, no new row needed.** NIDDK — What Is Chronic Kidney Disease?
(`.../what-is-chronic-kidney-disease`) is **#2** above, scraped to
`scraped/raw/niddk-what-is-ckd.md` and curated into
`knowledge/official-health-body/niddk/ckd-basics.md`. It is in the corpus today.
