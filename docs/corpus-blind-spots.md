# BATO — Corpus Blind Spots

**Knowledge-base audit, 2026-08-20.**

What the two BATO chatbots can and cannot answer today, read from the 122
chunks actually sitting in `public.knowledge_chunks` — not from the source
list. Every question below is one a Filipino user is likely to type and that
the system, as built, will deflect, answer thinly, or never see.

**Method.** Chunk census read directly from `public.knowledge_chunks` (project
`umgkrfslqjkszqhncned`), cross-read against the 21 curated files in
`knowledge/`, the exclusion record in [REVIEW-FLAGS.md](../knowledge/REVIEW-FLAGS.md),
the scope prompts in [gate.ts](../supabase/functions/_shared/gate.ts), and the
retrieval thresholds in [scopes.ts](../supabase/functions/_shared/scopes.ts).

**Caveat.** Mode tags are predictions from corpus contents and configured
thresholds, **not live query results**. Confirming them against the deployed
endpoints is the obvious next step.

---

> ## UPDATE 2026-08-30 — sections 1 and 2 have been largely closed
>
> Five sources were scraped, curated and ingested against this audit
> (SOURCES.md #26–#30). The corpus is now **150 chunks across 17 sources**, up
> from the 122/13 the census below describes. **The per-source table, the
> census and the `NO SOURCE` tags in §1 and §2 are stale as written** — the
> ranked recommendations at the foot of this document are what changed.
>
> Closed: items 1 (Philippine services and cost), 2 (named Filipino food) and
> most of the drink questions. See [REVIEW-FLAGS §13](../knowledge/REVIEW-FLAGS.md).
>
> **Live retrieval was checked this time, so these are results and not
> predictions.** Against the deployed pgvector RPC in the `general_education`
> scope, these questions now return the new chunks top-ranked:
>
> | Question (verbatim from below) | Now returns |
> |---|---|
> | "Where can I get my kidneys checked here in Davao?" | `DAVAOCHO` — *Where to get your kidneys checked in Davao City* |
> | "How much does a creatinine test cost?" | `DDH` — *What a creatinine test and urinalysis cost* |
> | "How much does one dialysis session cost?" | `PHILHEALTH` — *How much PhilHealth covers for one dialysis session* |
> | "How much does a kidney transplant cost with PhilHealth?" | `PHILHEALTH` — *How much the kidney transplant packages cover* |
> | "Can I still eat instant noodles and canned food?" | `NIDDK` — *Salty and processed foods to limit* |
> | "Which foods are high in potassium?" | `NIDDK` — *Keeping potassium in the right range* |
> | "Are softdrinks and energy drinks bad for my kidneys?" | `NKF` — *Energy drinks*, *Soft drinks and soda* |
> | "Can I drink beer or alcohol with kidney problems?" | `NKF` — *Alcohol* |
> | "Is low-sodium salt substitute safe?" | `NIDDK` — *Salty and processed foods to limit* |
>
> ### ⚠️ One failure, and it is the language risk in §9 — not a content gap
>
> **"Magkano ang creatinine test?" still deflects: nothing survives rerank.**
> The English "How much does a creatinine test cost?" returns the DDH cost
> chunks top-ranked, and so does the keyword form "creatinine test price Davao
> hospital". **The content is there and reachable; the Filipino wording is not
> reaching it.**
>
> This confirms §9's prediction as a live, measured failure rather than an
> inference, and promotes it to the most important open item in this document.
> "Magkano" is the single most likely way a Filipino user asks a cost question,
> and cost is the gap this batch was built to close — so the batch only half
> lands for the audience it was written for.
>
> Note the shape of the fix: chunks are embedded from `content` alone
> (`ingest-knowledge.ts` embeds `chunk.content`; `topic_tags` are **not**
> embedded), so adding Filipino terms to front-matter tags would do nothing.
> It takes either Filipino text in the chunk bodies, or query-side
> translation/expansion before embedding. **That is a product decision about
> what language BATO works in — both system prompts currently mandate English
> replies — so it is not a curation fix and was not made unilaterally.**
>
> Everything below is preserved as written on 2026-08-20.

---

## Corpus census

| Measure | Value |
|---|---|
| Chunks live | **122** |
| Source IDs | **13** |
| Curated files | **21** |
| Total words | **~7,200** |
| Sources registered but never ingested | **2** |
| Chunks in `screening_clarification` scope | **32** |

Per-source breakdown:

| Source | Chunks | ~Words | Scopes |
|---|---:|---:|---|
| NIDDK | 30 | 1,916 | both |
| CHEN2019 | 10 | 590 | general only |
| WHO | 10 | 507 | general only |
| KDIGO | 9 | 603 | both |
| SCORED | 9 | 652 | both |
| DOH | 8 | 252 | general only |
| PHESRD | 8 | 456 | general only |
| CDC | 8 | 423 | general only |
| APSN | 7 | 444 | general only |
| NICE | 7 | 428 | general only |
| ISN | 6 | 284 | general only |
| PSH | 5 | 310 | both |
| KDOQI | 5 | 322 | general only |

---

## The headline

The corpus is small and it is *guideline-shaped*. It is strong on definitions,
staging, testing, global and Philippine policy, and the SCORED instrument
itself. It is close to empty on the three things an ordinary Filipino user asks
first: **what do I eat**, **what does it cost and where do I go**, and **is
this herbal remedy safe**. Seven thousand words cannot cover a disease; the
gaps below are concentrated, not scattered.

---

## Failure modes

Each question is tagged with *how* it fails, because the fix differs by mode:

| Tag | Meaning |
|---|---|
| `NO SOURCE` | Corpus holds nothing; retrieval returns empty and the bot deflects. |
| `THIN` | Named in a list, never explained; answer is a fragment or falls under threshold. |
| `POLICY` | Deliberately excluded by `safety-boundaries.md` — deflection is correct. |
| `GATE` | Input classifier rules it out of scope before retrieval ever runs. |
| `PAYWALL` | Source is registered in the DB but was never fetched. |

---

## 1. Philippine cost, access and services

The single largest gap, and the one most damaging to a Davao-based capstone.
The corpus knows PhilHealth *session counts* and the PD-First policy; it knows
no prices, no facilities, no enrolment steps. A user who screens positive and
asks "so where do I go?" gets a generic "see a doctor or health center."

| Likely question | Mode | Why it fails |
|---|---|---|
| "Where can I get my kidneys checked here in Davao?" | `NO SOURCE` | No facility, referral-pathway, or geographic content anywhere. "Health center" appears in 2 chunks, both generic. |
| "Magkano ang creatinine test / urinalysis?" | `NO SOURCE` | No peso figure exists in the corpus. Zero hits for price or cost in currency terms. |
| "How much does one dialysis session cost?" | `NO SOURCE` | PHESRD gives session *counts* covered (156/yr from June 2023), never amounts. |
| "Is kidney screening free under PhilHealth Konsulta?" | `NO SOURCE` | Konsulta is not mentioned once. PhilHealth content is dialysis-only. |
| "Do senior citizens or PWDs get a discount on dialysis?" | `NO SOURCE` | No entitlement content at all. |
| "How do I apply for the PhilHealth transplant package?" | `NO SOURCE` | Coverage is described as a fact, never as a process a person can follow. |
| "What is NKTI and how do I get referred there?" | `NO SOURCE` | NKTI appears only inside a citation for a PSN statistic. |
| "What percent of Filipinos have CKD?" | `POLICY` | Deliberately excluded — no traceable PH prevalence survived verification (REVIEW-FLAGS §7, §12.3). |
| "What number cause of death is kidney disease in the Philippines?" | `POLICY` | Secondary sources disagree (7th/9th/10th); the corpus says only "among the leading causes". |
| "How much does CKD cost the Philippine economy?" | `PAYWALL` | Source #9 (Cost-of-Illness, *J. Med. Econ.* 2025) is registered but has no file and no scraped text. |
| "How many people die of kidney disease worldwide each year?" | `PAYWALL` | Source #10 (GBD 2023, *Lancet*) never fetched; no global death total is quoted anywhere by design. |

## 2. Filipino food and drink

The diet content is four chunks of qualitative guidance. It names no food, no
drink, and — by standing editorial rule — no number. Every question below is
high-frequency and every one of them fails.

| Likely question | Mode | Why it fails |
|---|---|---|
| "Is it okay to eat rice every day?" | `THIN` | "Rice" appears once, incidentally. No staple-food guidance exists. |
| "Can I still eat tuyo, bagoong, daing, or instant noodles?" | `NO SOURCE` | Corpus says "fewer processed, canned, salty, instant foods" and names nothing. |
| "Which fruits are high in potassium — saging? kamote?" | `NO SOURCE` | Potassium appears in 6 chunks, always as a lab value or a supervised limit. No food list exists. |
| "How many glasses of water should I drink a day?" | `POLICY` | Deliberate: fluid targets are individual and prescribed. Corpus says "enough water" only. |
| "How much salt or protein per day is safe for me?" | `POLICY` | KDOQI's per-kilogram figures were stripped on purpose (REVIEW-FLAGS §6, §12.2). |
| "Is coffee bad for the kidneys?" | `NO SOURCE` | Zero hits for coffee or caffeine. |
| "Are softdrinks and energy drinks bad for my kidneys?" | `NO SOURCE` | Zero hits for soda, soft drink, or energy drink. |
| "Can I drink beer or alcohol with kidney problems?" | `NO SOURCE` | Alcohol is not mentioned once in 122 chunks. |
| "Is low-sodium salt substitute safe?" | `NO SOURCE` | Not covered — and the honest answer (potassium load) needs a source the corpus lacks. |

## 3. Herbal and traditional remedies

In the Philippines this is not a fringe question. The corpus's entire position
is two clauses: "be cautious with herbal or detox supplements," and a Chen et
al. line listing herbal remedies among causes of CKD in developing countries.
No named plant, no DOH-approved herbal list.

| Likely question | Mode | Why it fails |
|---|---|---|
| "Is sambong good for the kidneys?" | `NO SOURCE` | Zero hits. Sambong is a DOH-endorsed herbal medicine — its absence is conspicuous for this audience. |
| "What about banaba, lagundi, or tawa-tawa?" | `NO SOURCE` | None appear. The bot can only issue the generic caution. |
| "Are kidney cleanse or detox teas safe?" | `THIN` | One clause covers it; likely too weak to clear the rerank threshold on its own. |
| "Can taking vitamin C, collagen, or protein powder damage my kidneys?" | `NO SOURCE` | Supplements appear only as a supervised prescription (potassium) or a generic caution. |

## 4. Medicines and kidney safety

Partly a deliberate boundary, partly a real gap. The drug classes were stripped
from CDC's risk-reduction list on purpose — but "which over-the-counter
painkiller is safe for me" is a safety question, not a treatment request, and
the corpus answers only half of it.

| Likely question | Mode | Why it fails |
|---|---|---|
| "Is paracetamol safe for the kidneys?" | `NO SOURCE` | Only NSAIDs (ibuprofen, mefenamic acid) are named as things to avoid. Paracetamol — the obvious follow-up — is absent. |
| "Why is mefenamic acid bad for the kidneys?" | `THIN` | Named in an avoid-list with no mechanism, no dose context, no "occasional vs regular" distinction beyond one word. |
| "What is an ACE inhibitor or ARB and why would a doctor give it?" | `POLICY` | Removed from the CDC file deliberately (REVIEW-FLAGS §12.2 item 1). |
| "Will my maintenance BP medicine damage my kidneys?" | `POLICY` | All PSH treatment content — targets, drug tables — was excluded. |
| "Is the dye used in a CT scan dangerous for kidneys?" | `NO SOURCE` | Contrast nephropathy is not covered at all. |
| "Do antibiotics harm the kidneys?" | `NO SOURCE` | NICE's "medicines that affect the kidneys" chunk is about monitoring clinicians, not naming drugs. |

## 5. Kidney conditions named but never explained

These all appear in the corpus — every one of them inside a comma-separated
list, in a chunk about something else. Retrieval will surface a list item and
the model will have nothing to say about it. **This is the most deceptive
failure mode: it looks like coverage in a keyword audit and behaves like a gap
in conversation.**

| Likely question | Mode | Why it fails |
|---|---|---|
| "What are kidney stones and how do I avoid them?" | `THIN` | 4 mentions, all list entries ("recurrent kidney stones" as a screening trigger / referral reason). Nothing explains what a stone is. |
| "Can UTI damage my kidneys?" | `THIN` | "Recurrent urinary tract infections" appears as a risk-list item only. |
| "What is polycystic kidney disease?" | `THIN` | One parenthetical gloss in the causes chunk; one mention of what SCORED cannot detect. |
| "What is glomerulonephritis?" | `THIN` | Same — a five-word parenthetical inside a causes list. |
| "What is acute kidney injury, and how is it different from CKD?" | `THIN` | AKI appears once, in a nephrology-referral list. The acute/chronic distinction — the thing the 3-month rule implies — is never spelled out for a layperson. |
| "Is blood in my urine serious?" | `NO SOURCE` | The SCORED file explicitly notes the tool asks nothing about hematuria; no other chunk covers it. |
| "Does high uric acid or gout affect the kidneys?" | `THIN` | One passing mention. Common comorbid concern in Filipino patients. |
| "Does an enlarged prostate cause kidney problems?" | `THIN` | A NICE risk-list bullet, nothing more. |
| "Does lupus affect the kidneys?" | `THIN` | One mention inside "multisystem diseases". |

## 6. Living with CKD — practical and psychosocial

The corpus treats CKD as an epidemiological and diagnostic object. It almost
never treats it as something a person lives inside. These are the questions
that arrive after a Screen Positive result.

| Likely question | Mode | Why it fails |
|---|---|---|
| "Can I still work if I'm on dialysis?" | `NO SOURCE` | Employment and daily-life impact are uncovered. ISN's barriers chunk is about health systems, not individuals. |
| "Can I work abroad as an OFW with kidney disease?" | `NO SOURCE` | Not covered, and highly specific to this audience. |
| "Can I still have children if I have CKD?" | `THIN` | WHO's pregnancy chunk is policy-level (hypertensive disorders in ~1 in 10 pregnancies), not personal guidance. |
| "Does kidney disease affect sex or fertility?" | `NO SOURCE` | Zero coverage. |
| "I'm scared after my result — how do I cope?" | `NO SOURCE` | Mental health appears in 3 chunks as a comorbidity or a system statistic, never as support. |
| "How do I ask a family member to be my kidney donor?" | `NO SOURCE` | Donors appear twice, both structural ("few Filipinos get a transplant"). No process, no eligibility. |
| "Is it safe to donate a kidney?" | `NO SOURCE` | Living-donor risk is entirely absent. |
| "What is a fistula, and how is dialysis access created?" | `NO SOURCE` | Zero hits for fistula or catheter. |
| "What happens during a dialysis session — how long, how often?" | `THIN` | HD and PD are defined at one sentence each. Session duration, frequency, and what it feels like are absent. |
| "Why do dialysis patients get cramps and itching?" | `THIN` | Cramps and itching appear as CKD symptoms, never as dialysis effects. |

## 7. Test and procedure practicalities

The strongest area of the corpus — and still missing the logistics a person
needs to actually go and get tested.

| Likely question | Mode | Why it fails |
|---|---|---|
| "Do I need to fast before a creatinine blood test?" | `NO SOURCE` | Test preparation is nowhere in the corpus. |
| "How do I collect a urine sample properly?" | `NO SOURCE` | The dipstick-vs-ACR distinction is covered; the act of collecting is not. |
| "What is a kidney ultrasound or biopsy, and when is one needed?" | `NO SOURCE` | Biopsy appears only inside an APSN percentage. Imaging is absent entirely. |
| "My eGFR is 55 — what does that mean for me?" | `POLICY` | Correctly refused as personal interpretation; the output guard also blocks diagnostic phrasing. Users will still ask constantly. |
| "My result was normal — when should I test again?" | `THIN` | "Who should get checked, and how often" is a 216-character chunk; NICE monitoring content is aimed at clinicians. |

## 8. Special populations

| Likely question | Mode | Why it fails |
|---|---|---|
| "Can children get kidney disease?" | `NO SOURCE` | The corpus is adult-only throughout; the three "child" hits are incidental. |
| "Is CKD hereditary? Will my children get it?" | `THIN` | Only the PKD parenthetical touches inheritance. Chen et al.'s genetics section was deliberately excluded as US ancestry epidemiology. |
| "I'm over 70 — is my risk different?" | `THIN` | SCORED's own caveat about ages above 70 exists; ageing-kidney physiology does not. |
| "I'm pregnant — should I get my kidneys checked?" | `THIN` | One WHO policy chunk, framed at country level. |

## 9. Blocked before retrieval — the gate, not the corpus

These never reach the knowledge base. The input classifier in `gate.ts` marks
them out of scope, so **no amount of corpus work fixes them** — the scope
prompt or the product would have to change.

| Likely question | Mode | Why it fails |
|---|---|---|
| "What is BATO? How does this app work?" | `GATE` | The general scope prompt admits kidney topics only. Questions about the product itself are classified out of scope — and there is no corpus content about BATO either. |
| "Is my answer data private? Who sees my result?" | `GATE` | Same. A privacy question in a health app that deflects is a trust problem, not just a coverage one. |
| "Kumusta! Ano ang pwede mong gawin?" | `GATE` | Small talk and capability questions are explicitly out of scope. There is no onboarding answer. |
| "Ano ang sakit sa bato? / Unsa ang sakit sa kidney?" | `GATE` | Nothing in the corpus is in Filipino or Cebuano, and both system prompts mandate replies in English. For a Davao study population this is a first-order risk — flag it even if the answer is "English-only by design." |
| "My score was 6 — is that bad?" | `GATE` | The clarification gate rules out "questions about the score or what answering a certain way would do." Mid-assessment, this deflects by design; users will ask it there anyway. |
| "I have diabetes — what should I eat for it?" | `GATE` | Out of scope unless a kidney connection is stated. Correct, but the most likely comorbid follow-up in the whole product. |

---

## Where to spend the next curation pass

Ranked by how many likely questions each unlocks per source added, not by how
authoritative the source is.

1. **A Philippine services and cost file.** PhilHealth Konsulta, senior/PWD
   entitlements, where screening happens, indicative test costs. Unlocks the
   entire first section and is the natural landing place for a screen-positive
   user. Needs a citable primary source — PhilHealth circulars, DOH releases.
2. **Named Filipino foods, still without numbers.** A qualitative file that
   names staples and common high-sodium/high-potassium items keeps the
   no-numeric-threshold rule intact while answering the most common question
   class in the product.
3. **A DOH herbal-medicine file.** Sambong and the other DOH-endorsed herbals,
   stated honestly — including that endorsement for one use is not evidence for
   another. High cultural salience, currently zero coverage.
4. **Promote the list-mention conditions to their own sections.** Kidney
   stones, UTI, AKI vs CKD, hematuria, PKD. Cheap: the sources already in the
   corpus (NIDDK, NICE, Chen) cover all of these; only curation is missing.
   Fixes the "looks covered, behaves empty" mode.
5. **A living-with-CKD file.** Work, travel, dialysis access, what a session is
   actually like, coping. NIDDK has this material and is already an approved
   source.
6. **Obtain the two paywalled sources.** PHCOI (#9) and GBD (#10) are
   registered and empty. PHCOI was the intended home of the Philippine burden
   figures that REVIEW-FLAGS §7 still lists as unresolved.
7. **Decide the meta-question policy.** "What is BATO" and "is my data private"
   are gate decisions, not corpus decisions. Either widen the scope prompt with
   a small product-facts file, or handle them in the UI before the gate.
