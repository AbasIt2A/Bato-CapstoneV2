# BATO — System Overview

**As-built description of the system in this repository, 2026-08-10.**

This document describes what exists and runs today: the two chatbots, the
shared retrieval pipeline they sit on, the deterministic screening controller,
the data model, the knowledge-base build pipeline, and the state of each part.
It is a companion to — not a replacement for — the three specification
documents, which state what the system is *supposed* to do:

| Document | Role |
|---|---|
| [BATO_PRD.md](../BATO_PRD.md) | Product requirements (FR/NFR numbering used throughout the code comments) |
| [BATO_Hardened_RAG_Prompt.md](../BATO_Hardened_RAG_Prompt.md) | The hardened-RAG retrofit spec (§ numbers used in code comments) |
| [BATO Manuscript.md](../BATO%20Manuscript.md) | The capstone manuscript |
| [README.md](../README.md) | Pipeline summary + env reference |
| [SETUP.md](../SETUP.md) | Step-by-step setup guide |
| [SOURCES.md](../SOURCES.md) | The Top-20 knowledge-base source list and its rationale |
| [docs/manuscript-alignment.md](manuscript-alignment.md) | Plain-language summary for the manuscript |

---

## 1. What BATO is

A CKD (chronic kidney disease) risk-screening and awareness web application
for a Philippine capstone study. It has two user-facing conversational
surfaces plus an evaluation survey:

1. **Risk Assessment** — a nine-question SCORED screening questionnaire
   (Bang et al., 2007) driven by a **deterministic state machine with no LLM
   anywhere on the scoring path**, with an LLM **Clarification Engine** as a
   read-only side branch for "what does *proteinuria* mean?" asides.
2. **General Kidney Health Chatbot** — free-form Q&A about kidney health, answered only from a
   curated corpus via hardened retrieval-augmented generation, deflecting
   anything off-topic.
3. **Evaluation** — SUS / TAM / TiMT instruments captured for the study.

The footer disclaimer is part of the product, not decoration: BATO is a
screening and awareness tool, not a medical device, and the SCORED instrument
is used under license from AstraZeneca Philippines (PH-6850).

---

## 2. Architecture at a glance

```
                         Browser (React 19 + Vite, anonymous Supabase session)
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
       ▼                            ▼                            ▼
  /assessment                    /chat                      /evaluate
  AssessmentChat.tsx          GeneralChat.tsx            EvaluationForm.tsx
       │        │                   │                            │
       │        └── aside ──┐       │                            │ direct insert
       ▼                    ▼       ▼                            │ (RLS-guarded)
┌─────────────┐      ┌───────────────────────────┐               │
│  screening  │      │  clarify   │ general-chat │               │
│ Edge Fn     │      │  Edge Fn   │  Edge Fn     │               │
│ NO LLM      │      └──────┬─────┴──────┬───────┘               │
│ (FR-4)      │             │            │                       │
└──────┬──────┘             └──── shared retrieval pipeline ─┐   │
       │                            (_shared/*.ts)           │   │
       ▼                                                     ▼   ▼
┌──────────────────────────── Supabase (one project) ─────────────────────┐
│ auth.users (anonymous sign-ins)                                          │
│ assessments · assessment_responses · evaluation_responses                │
│ knowledge_sources (the source register) · knowledge_chunks (pgvector)    │
│ answer_cache (pgvector)                                                  │
│ RPCs: match_knowledge_chunks · match_answer_cache · touch_answer_cache  │
└──────────────────────────────────────────────────────────────────────────┘
       │                     │                    │
   Gemini (embed+gen)     Groq (gate)         Cohere (rerank)
```

One Supabase project backs everything. One knowledge corpus backs both
chatbots. What separates the chatbots is **scope metadata applied inside the
RPC**, not separate tables or projects.

---

## 3. Frontend

Vite + React 19 + `react-router-dom` 7, TypeScript, no UI framework
(hand-written CSS in [index.css](../frontend/src/index.css)).

| Path | Route | Notes |
|---|---|---|
| [App.tsx](../frontend/src/App.tsx) | shell | Header nav + the permanent medical/licensing disclaimer |
| [pages/Home.tsx](../frontend/src/pages/Home.tsx) | `/` | Landing |
| [features/assessment/AssessmentChat.tsx](../frontend/src/features/assessment/AssessmentChat.tsx) | `/assessment` | Drives the nine steps; holds the current step across a clarification aside |
| [features/assessment/ConsentGate.tsx](../frontend/src/features/assessment/ConsentGate.tsx) | — | RA 10173 consent, session-scoped (`sessionStorage`, [consent.ts](../frontend/src/lib/consent.ts)) |
| [features/assessment/ResultsScreen.tsx](../frontend/src/features/assessment/ResultsScreen.tsx) | — | Score + binary classification |
| [pages/GeneralChat.tsx](../frontend/src/pages/GeneralChat.tsx) | `/chat` | Q&A with source chips; sends the last 3 completed exchanges so follow-ups resolve |
| [lib/source-links.ts](../frontend/src/lib/source-links.ts) | — | Public page per registered source, so each chip links out; a second mirror of the register, held in step by [source_links_test.ts](../tests/source_links_test.ts) |
| [features/evaluation/EvaluationForm.tsx](../frontend/src/features/evaluation/EvaluationForm.tsx) | `/evaluate` | SUS / TAM / TiMT |

**Identity.** Every visitor gets an anonymous Supabase Auth session
([supabase-client.ts](../frontend/src/lib/supabase-client.ts)); the JWT is
attached automatically to `functions.invoke()`. All three Edge Functions run
with `verify_jwt = true`.

**The clarification client contract matters.**
[assessment-api.ts](../frontend/src/lib/assessment-api.ts) deliberately sends
`clarify` *only* a question plus an optional `variableKey` retrieval hint —
never an `assessmentId`. The client, not the server, remembers which step the
user was on and re-displays it afterwards. That asymmetry is the structural
guarantee described in §5.3.

**Note:** [instruments.ts](../frontend/src/features/evaluation/instruments.ts)
carries a ⚠️ CONFIRM flag — the TAM and TiMT item wordings are standard
adaptations drafted for BATO and must be aligned verbatim with the
manuscript-approved instruments before the evaluation study runs. SUS is the
standard 10-item Brooke (1996) scale.

---

## 4. Edge Functions (Deno, Supabase)

Three functions, all `verify_jwt = true`, all CORS-gated by `ALLOWED_ORIGIN`
(falls back to `*` with a loud module-load warning if unset).

### 4.1 `screening` — Rule-Based Screening Controller

[supabase/functions/screening/index.ts](../supabase/functions/screening/index.ts)
— HTTP/DB glue around the pure state machine in
[_shared/screening-flow.ts](../supabase/functions/_shared/screening-flow.ts).

**It has no LLM dependency of any kind (FR-4).** Actions: `start`, `answer`,
`status`, `abandon`. Invalid input re-asks the same step with a deterministic
message; the LLM is never consulted to interpret an answer.

Scoring lives in [_shared/scored.ts](../supabase/functions/_shared/scored.ts),
a pure, import-free module — the only place in the system where a SCORED total
may be computed:

- Age tiers: `<50 → 0`, `50–59 → 2`, `60–69 → 3`, `≥70 → 4`
- Eight binary variables (`female`, `anemia`, `hypertension`, `diabetes`,
  `cvd_history`, `chf_history`, `pvd`, `proteinuria`): present → 1
- Max 12; **Screen Positive at ≥ 4**, otherwise Screen Negative
- Malformed input throws rather than coercing — an invalid answer must never
  silently score 0 or 1

On the final answer the function recomputes the total from stored responses
and **fails loudly if the recomputed total does not equal the sum of the
per-step `points_awarded` already written** — a corruption tripwire.

### 4.2 `general-chat` — General Kidney Health Chatbot

[supabase/functions/general-chat/index.ts](../supabase/functions/general-chat/index.ts).
Stateless on the server, scope hard-locked to `general_education` in code
(never read from the request). Max message length 2000.

**Second-chance retrieval.** The reranker scores how a question is *phrased*,
not only what it asks, so a worried personal framing can miss the threshold
while the corpus holds the answer and ranks it first — measured 2026-08-15:
"When should I be worried about going under dialysis treatment?" scored 0.292
against the passage on starting dialysis, versus 0.682 for "When do people
need to start dialysis?" on the same passage. Rather than lower the threshold
(the numbers forbid it — a genuine corpus gap deflected at 0.254, only 0.04
away), an empty rerank triggers one Groq rephrase and one retry. The rewrite
is used for retrieval only: the cache key, the generation prompt and the reply
all stay with the user's own question.

**Attribution without prose citations.** Replies name no sources in their
sentences. The model instead ends each answer with a machine-readable
`SOURCES: NIDDK, APSN` line; the function verifies those IDs against the
retrieved chunks (a chunk's own `source`, plus any approved body the passage
credits inline), strips the line, strips any citation the model wrote into the
prose anyway, and returns the IDs as the frontend's source chips. A reply
declaring nothing verifiable is deflected exactly as an uncited one was. The
alternative — checking groundedness by comparing wording to the passages —
was measured and rejected; see the note in
[citations.ts](../supabase/functions/_shared/citations.ts). `clarify` is
unchanged and still cites in prose, because the assessment UI has no chip row.

Each chip is a link to that source's public page, resolved on the client from
the source ID ([source-links.ts](../frontend/src/lib/source-links.ts)). The URL
is deliberately not part of the citation payload: `answer_cache` stores that
payload verbatim and has no TTL, so a server-side field would leave every
already-cached reply's chips dead. One URL per SOURCE, never per document —
a passage may credit an approved body that did not publish the file it sits in.

**Conversation context.** The request may carry `history` — the recent turns,
sent by the client, stored nowhere. It reaches the gate only, which reads the
message in that context and returns `standalone_question`: the message
rewritten to stand alone. Everything after the gate (cache key, both
embeddings, retrieval, rerank, generation) runs on that resolved question, so
a follow-up like "how bad is this?" both passes the scope check and retrieves
on its real subject. History is unverified client input and is treated as
such — the layer-1 regex screens every turn, turns are delimiter-neutralized
inside their own untrusted region, and the rewrite is re-screened before use.
Absent history, the path is byte-for-byte the single-turn one.

### 4.3 `clarify` — LLM Clarification Engine

[supabase/functions/clarify/index.ts](../supabase/functions/clarify/index.ts).
Same pipeline, stricter thresholds, scope hard-locked to
`screening_clarification`. Max question length 500. Temperature 0 (sampling
variance was causing it to refuse valid screening questions ~1 run in 4). Adds
one stage general-chat lacks in the same position — see §5.3.

**Every infrastructure failure in both RAG functions degrades to the approved
deflection with a server-side log — never a raw 500, and never a stall
mid-assessment.**

---

## 5. The shared retrieval pipeline

All of [supabase/functions/_shared/](../supabase/functions/_shared/), used by
both RAG functions.

### 5.1 Stages

```
[1] Input gate            gate.ts — layer 1 regex pre-screen (FINAL if hit,
                          skips the LLM call), layer 2 JSON classifier on
                          Groq → Gemini fallback → fail open
                          {in_scope, injection_detected, reason}
   │                      off-topic or injection ⇒ deflect
   ▼
[2a] Answer cache tier 1  scope-filtered equality select on question_norm
                          HIT ⇒ stored reply; no LLM call, no embedding
   │ (miss)
   ▼
[2b] Embed ×2 in parallel gemini-embedding-001 @ 768 dims
                          RETRIEVAL_QUERY (for [3]) + SEMANTIC_SIMILARITY (for [2c])
   ▼
[2c] Answer cache tier 2  match_answer_cache RPC, scope-filtered,
                          cosine ≥ 0.97 (general) / 0.98 (clarify)
   │ (miss)
   ▼
[3] pgvector recall       match_knowledge_chunks RPC — parameterized, scope
                          filtered inside the RPC, top-K + cosine floor per scope
   ▼
[4] Rerank                Cohere rerank-v3.5, keep top-N above threshold;
                          no key / API failure ⇒ cosine-ordering fallback
   ▼
[4b] Second-chance retrieval (general-chat) nothing passed ⇒ rephrase the
                          question once into a neutral form (Groq) and retry
                          embed+retrieve+rerank; still nothing ⇒ deflect
   ▼
[5] Grounded generation   system prompt = ONLY trusted instructions; chunks +
                          question wrapped in UNTRUSTED delimiters; every
                          source used must be declared
   ▼
[6] Attribution (general-chat) citations.ts — verify the declared SOURCES line
                          against what was retrieved, strip it and any inline
                          citation; nothing declared ⇒ deflect
   ▼
[6] Self-declination check (clarify only) model emitting the approved refusal
                          verbatim is reported as a deflection, not an answer
   ▼
[7] Diagnostic filter     topic-filter.ts — never let "you have CKD" reach a user
   ▼
[8] Output guard          output-guard.ts — delimiter leakage, verbatim
                          system-prompt windows, "rules changed" claims,
                          citation/groundedness ⇒ deflect
                          (general-chat runs it with requireCitation:false —
                          step 6 already checked attribution)
   ▼
[9] Cache write           success path only — a deflection is never cached
```

The cache probe sits **after** the gate and the write happens **after** every
guard, so caching can neither bypass screening on the way in nor preserve an
unguarded reply on the way out.

### 5.2 Scope separation

[_shared/scopes.ts](../supabase/functions/_shared/scopes.ts) is the single
auditable object holding every per-scope parameter:

| Parameter | `general_education` | `screening_clarification` |
|---|---|---|
| `topK` | 20 | 12 |
| `vectorFloor` | 0.45 | 0.50 |
| `rerankThreshold` | 0.30 | **0.45** |
| `rerankTopN` | 4 | 3 |
| `fallbackSimilarity` (no-reranker path) | 0.60 | **0.57** |
| `cacheHitThreshold` | 0.97 | **0.98** |

Clarification is stricter everywhere **except `fallbackSimilarity`**, and that
exception is deliberate and measured. The old 0.65 was not strict but
*unreachable*: phrasing a term as a question costs ~0.03 cosine, so the engine
deflected every natural-language question while answering bare keywords. Two
things changed together, and the second did the real work — the floor came
down to 0.57, **and** the screening file was restructured from one 1429-char
chunk covering all nine SCORED variables into one H2 section *per variable*.
Nine terms sharing one embedding diluted every one of them.

(That file was `screening-and-scored.md` at the time. On 2026-08-11 it split
by provenance into `screening-and-risk-factors.md` and
`peer-reviewed/scored/scored-instrument.md`; the nine sections moved verbatim
and only `content` is embedded, so the vectors below are unchanged.)

Post-restructure top cosine per term (2026-08-06, 39 chunks): PVD 0.791, age
0.752, sex 0.740, proteinuria 0.738, anemia 0.718, hypertension 0.680, heart
failure 0.669, CVD 0.664, diabetes 0.662. Off-topic controls: 0.489, 0.494.
So 0.57 sat in open space — 0.09 below the weakest in-scope term, 0.08 above
the strongest off-topic probe.

**Re-measured 2026-08-30** against the live 122-chunk corpus with
[scripts/measure-clarification.ts](../scripts/measure-clarification.ts), whose
probe strings are pinned in source so future runs are exactly comparable
(REVIEW-FLAGS.md §14.8): bp_threshold 0.830, PVD 0.789, uACR 0.789, albumin
0.782, proteinuria 0.781, CKD definition 0.767, eGFR 0.718, anemia 0.714, age
0.703, CVD 0.693, hypertension 0.686, heart failure 0.674, diabetes 0.636,
sex 0.633. Off-topic controls: 0.541, 0.518, 0.513.

**Still a pass, on a margin that has roughly halved.** Every in-scope probe
clears 0.57 and every control stays below it, but separation is now 0.092
against ~0.17 in August — 0.063 of headroom below the weakest term and only
0.029 above the strongest control. `sex` fell 0.107 to become the weakest
probe, and the weather control rose to 0.541 by matching the PSH
blood-pressure chunk, which did not exist in the 39-chunk corpus. Adding
clarification-scoped files gives an off-topic probe more surface to land on;
treat a control above ~0.55 as a signal to raise the floor rather than widen
the corpus. **If a future edit merges those sections back together, this
margin collapses and the engine silently starts deflecting again.**

**Re-measured 2026-09-28 after the 171-chunk ingestion:** the weakest in-scope
probe is 0.634 (sex) and the strongest off-topic probe is 0.540 (weather).
All probes still separate at the 0.57 fallback floor; the threshold is unchanged.

A chunk may carry *both* scopes. The invariant is "every retrieved passage
carries the requested scope", not corpus disjointness.

### 5.3 Why the Clarification Engine cannot touch a score

The design claim is that the two subsystems are separated by scope metadata
within a single pipeline rather than by separate infrastructure. The
clarification branch runs the same corpus, embedding model, reranker and
output guard as the general chatbot, differing only by scope and thresholds.

Scoring did **not** move and must not. The guarantee that a clarification can
never alter a recorded variable is not a prompt instruction — it is the
absence of a mechanism:

- `clarify` accepts **no assessment ID and no answer value**;
- it holds **no reference** to the state machine;
- it performs **no writes** of assessment data;
- its response carries prose and citations only — no step, no score, no
  classification.

There is therefore no code path, correct or malicious, by which a
clarification alters a recorded variable.

### 5.4 Trust separation and injection defense

- The system prompt is the **only** instruction region. Retrieved chunks and
  the user question are wrapped in labeled `UNTRUSTED` delimiters
  ([rag-content.ts](../supabase/functions/_shared/rag-content.ts)) and never
  concatenated into instructions; delimiter tokens appearing inside untrusted
  text are neutralized.
- Layer-1 regex covers instruction override, prompt leak, role swap,
  delimiter break/forgery, role-prefix smuggling, rule-change requests. **A
  regex hit is final** — the LLM layer never overrides it, and the call is
  skipped entirely.
- Layer 2 **fails open** on API error (availability beats strictness) because
  the rerank threshold and the output guard still stand behind it.
- Kidney-health scope is enforced at **three** layers: input gate → rerank
  relevance threshold → system-prompt refusal. Off-topic questions get the
  approved deflection even when benign.
- The clarification engine uses its **own gate prompt**: the
  general-education prompt rejects "other diseases", which is most of the nine
  SCORED variables.
- The `variableKey` hint is client-supplied and therefore untrusted, but
  harmless by construction — it only widens the *text* of the embedding query,
  never the scope, and is sanitized to word characters so it cannot smuggle
  delimiters.

### 5.5 The two-tier answer cache

Embedding similarity **cannot** safely decide whether two questions mean the
same thing on this corpus. Measured 2026-08-07:

| | RETRIEVAL_QUERY | SEMANTIC_SIMILARITY |
|---|---|---|
| same meaning, lowest | 0.729 | 0.885 |
| different meaning, highest | 0.863 | **0.925** |

The bands overlap under both geometries. *"How do I prevent CKD?"* vs *"How do
I treat CKD?"* scores 0.925 — higher than the genuine paraphrase *"Can you
explain chronic kidney disease?"* / *"what does CKD mean"* at 0.885. No
threshold sits between them. The cause is structural: these embeddings encode
*topic*, while prevent/treat and curable/preventable are single operators that
barely move the vector yet completely change the correct answer. And nothing
downstream can catch the error — a cached reply is served verbatim, having
passed its guards for a *different* question.

So **tier 1 (exact match on normalised text)** carries the savings: zero
false-hit risk by construction, no embedding call, and it catches the dominant
repeat pattern of a scripted evaluation session. **Tier 2 (similarity)** sits
*above* the entire measured overlap at 0.97/0.98 and is a rare backstop by
design. Lowering it to chase hit rate walks straight back into the overlap.

Clarification caches on the *hinted* string (`"<variableKey>: <question>"`),
not the bare question — "what does that mean?" on the anemia step and on the
proteinuria step are different questions that happen to share their text.

---

## 6. Providers and the free-tier quota budget

Gemini's free tier allows **20 `generateContent` requests per day, per project
per model**. Three design choices keep that from capping the system at ~10
messages/day:

| Stage | Provider / model | Quota bucket |
|---|---|---|
| Input gate (primary) | Groq `openai/gpt-oss-20b` | not Gemini at all |
| Input gate (fallback, only if Groq unset/failing) | `gemini-3.5-flash` | A |
| `general-chat` generation | `gemini-3.5-flash-lite` | B |
| `clarify` generation | `gemini-3.1-flash-lite` | C |
| Embeddings | `gemini-embedding-001` (768-dim) | separate, far larger |
| Rerank | Cohere `rerank-v3.5` | separate provider |
| Source scraping (primary) | Firecrawl | separate provider |
| Source scraping (fallback) | Tavily `/extract` | separate provider |

**The three Gemini model names must stay distinct** — two roles sharing a name
share one 20/day allowance. `deno task check:providers` warns on collision and
verifies every model with a real call (the `GET /models` listing is optimistic
and lists models a key cannot actually call).

The gate's Gemini fallback is a genuine second attempt, not a formality: a
Groq outage that would previously have disabled scope/injection screening
outright now costs one Gemini request instead.

---

## 7. Data model

Migrations in [supabase/migrations/](../supabase/migrations/), applied in
timestamp order.

| Migration | What it does |
|---|---|
| `20260708000001_knowledge_chunks.sql` | pgvector, `knowledge_chunks`, `match_knowledge_chunks`, deny-by-default RLS |
| `20260806000001_source_register_and_scopes.sql` | Replaces the fixed source CHECK with the `knowledge_sources` register + FK; adds `scopes` and the scope-filtered RPC (old unscoped 3-arg RPC **dropped**, not overloaded — leaving it callable would be a scope bypass with a service-role grant attached) |
| `20260806000002_register_psa_source.sql` | Admits PSA — the first source admitted by data rather than schema change |
| `20260806164155_assessments_and_evaluation.sql` | `assessments`, `assessment_responses`, `evaluation_responses`, RLS |
| `20260807000001_answer_cache.sql` | `answer_cache` + `match_answer_cache` |
| `20260807000002_answer_cache_exact_tier.sql` | `question_norm` exact-match tier; purges rows embedded in the old geometry |
| `20260810145929_register_top20_sources.sql` | Registers the nine remaining Top-20 publishers (**untracked/new**) |

### Tables

- **`knowledge_sources`** — the source register the manuscript requires at
  submission: id, name, inclusion-framework category
  (`official_health_body` / `clinical_guideline` / `peer_reviewed`),
  publication year, adviser approval date. `knowledge_chunks.source` is a FK
  onto it, so **an unregistered source is physically unstorable**. Mirrored
  for display and offline validation in
  [_shared/sources.ts](../supabase/functions/_shared/sources.ts) — register
  without mirroring and citations render as bare IDs; mirror without
  registering and ingestion fails on the FK.
- **`knowledge_chunks`** — `source` (FK), `title`, `heading_path`
  (`"H1 > H2 [> H3]"` breadcrumb), `content`, `embedding vector(768)`,
  `topic_tags`, `scopes`. RLS enabled with **no policies** — service role only.
- **`answer_cache`** — `scope` (CHECK), `question_norm`, `embedding
  vector(768)` in SEMANTIC_SIMILARITY geometry, `reply`, `sources`, `model`.
  Never visible across scopes.
- **`assessments`** — one screening session; `total_score` 0–12,
  `classification` ∈ {Screen Negative, Screen Positive}, `status` ∈
  {in_progress, completed, abandoned}, plus a CHECK that a completed
  assessment must carry its score, classification and completion time.
- **`assessment_responses`** — one row per answered variable, `variable_key`
  CHECK-constrained to the nine, `points_awarded` range-checked per variable
  (age 0–4, others 0–1), `unique (assessment_id, variable_key)`.
- **`evaluation_responses`** — instrument ∈ {SUS, TAM, TiMT}, `responses`
  jsonb, `score`.

`chat_sessions` / `chat_messages` were **removed on 2026-08-10**: no source
file referenced them, they did not exist in the deployed database, and nothing
ever wrote to them. If conversation logging is wanted later it should be
designed against the RA 10173 retention/consent requirements, not resurrected.

### RLS model (RA 10173)

All screening writes happen server-side under the service role (which bypasses
RLS). Browser clients get read-only access to *their own* rows, plus direct
insert on `evaluation_responses` — the one flow with no server-side logic.
Everything else is deny-by-default. All DB access from functions is via
parameterized RPC; no string-built SQL anywhere.

---

## 8. The knowledge base and its build pipeline

### 8.1 Current corpus (ingestable today)

Twenty-one curated documents under [knowledge/](../knowledge/), filed by
inclusion-framework category — `official-health-body/<body>/`,
`clinical-guidelines/<body>/`, `peer-reviewed/<source>/`. The folder documents
provenance; the front-matter `source` field still *defines* it.

`deno task ingest:dry` currently validates **121 chunks across 21 files**:

| File | Source | Chunks | Scopes |
|---|---|---|---|
| `clinical-guidelines/apsn/diabetes-and-kidney-disease.md` | APSN | 7 | general |
| `clinical-guidelines/isn/global-kidney-care-capacity.md` | ISN | 6 | general |
| `clinical-guidelines/kdigo/ckd-definition-and-testing.md` | KDIGO | 8 | **both** |
| `clinical-guidelines/kdigo/ckd-stages.md` | KDIGO | 1 | general |
| `clinical-guidelines/kdoqi/nutrition-care-in-ckd.md` | KDOQI | 5 | general |
| `clinical-guidelines/nice/who-should-be-tested.md` | NICE | 7 | general |
| `clinical-guidelines/psh/high-blood-pressure-in-the-philippines.md` | PSH | 5 | **both** |
| `official-health-body/cdc/ckd-basics-and-awareness.md` | CDC | 8 | general |
| `official-health-body/doh/kidney-health-philippines.md` | DOH | 8 | general |
| `official-health-body/niddk/ckd-basics.md` | NIDDK | 2 | general |
| `official-health-body/niddk/diet-and-lifestyle.md` | NIDDK | 3 | general |
| `official-health-body/niddk/safety-boundaries.md` | NIDDK | 1 | **both** |
| `official-health-body/niddk/screening-and-risk-factors.md` | NIDDK | 9 | **both** |
| `official-health-body/niddk/symptoms-causes-complications.md` | NIDDK | 3 | **both** |
| `official-health-body/niddk/tests-and-diagnosis.md` | NIDDK | 9 | **both** |
| `official-health-body/niddk/treatment-dialysis-transplant.md` | NIDDK | 2 | general |
| `official-health-body/who/kidney-health-policy.md` | WHO | 9 | general |
| `official-health-body/who/statistics-and-burden.md` | WHO | 1 | general |
| `peer-reviewed/chen2019/ckd-overview-for-primary-care.md` | CHEN2019 | 10 | general |
| `peer-reviewed/phesrd/esrd-care-in-the-philippines.md` | PHESRD | 8 | general |
| `peer-reviewed/scored/scored-instrument.md` | SCORED | 9 | **both** |

Forty-two chunks carry diet/clinical numeric values flagged for adviser
awareness; these are tracked in
[knowledge/REVIEW-FLAGS.md](../knowledge/REVIEW-FLAGS.md).

Two changes on 2026-08-11 got the corpus here. First, `peer-reviewed/scored/`
split the SCORED instrument's own content (point weights, cutoff, accuracy,
age and sex) out of the NIDDK-fronted screening file — since a chunk is stored
under its file's front-matter `source` unconditionally, every SCORED figure
had been recording `NIDDK` as its provenance (REVIEW-FLAGS §11). Second, the
Top-20 curation added eleven files covering every remaining non-paywalled
source in [SOURCES.md](../SOURCES.md) (REVIEW-FLAGS §12).

**Two of the twenty are still missing, both paywalled**: PHCOI (#9,
*Journal of Medical Economics*) and GBD (#10, *The Lancet*). Neither was ever
fetched — `scraped/raw/` has no entry for either — and nothing was substituted
in their place. Both stay registered in `public.knowledge_sources`, so
curating them later needs no schema or code change. PHCOI's absence is the
reason the Philippine burden gaps in REVIEW-FLAGS §7 remain open.

[scripts/chunker.ts](../scripts/chunker.ts) is a pure markdown-header chunker:
H2 boundaries, H3 kept with its parent, small overlap on long sections. It
**hard-rejects any document with `approved: false`** and any unregistered
source ID, before a database connection exists.

### 8.2 The Top-20 expansion (in flight)

[SOURCES.md](../SOURCES.md) lists the twenty sources selected to expand the
corpus, each with its rationale.
[scripts/scrape/manifest.ts](../scripts/scrape/manifest.ts) is its
machine-readable twin. Two-stage pipeline, deliberately split so a
cleaning-rule bug is fixed and re-run for free without re-fetching (and
re-paying for) twenty documents:

```
SOURCES.md ─→ manifest.ts ─→ scrape-sources.ts ─→ scraped/raw/<id>.md
                            (Firecrawl, 1 credit/URL,      + <id>.meta.json
                             7s pacing for the 10 rpm      VERBATIM, auditable
                             free-tier limit; falls back   `provider` field
                             to Tavily on failure or       records which one
                             exhausted credits)            answered
                                       │
                                       ▼
                             clean-scraped.ts ─→ scraped/clean/<id>.md
                             (offline, idempotent,   ALWAYS `approved: false`
                              cleaner.ts rules)
                                       │
                       ┌───────────────┴────────────────┐
                       │  HUMAN CURATION — cut to the   │
                       │  passages worth embedding,      │
                       │  write real headings, verify    │
                       │  every clinical number against  │
                       │  the source, log in             │
                       │  REVIEW-FLAGS.md, adviser       │
                       │  sign-off, flip approved: true  │
                       └───────────────┬────────────────┘
                                       ▼
                        knowledge/<category>/<body>/*.md
                                       │
                                       ▼
                             ingest-knowledge.ts ─→ knowledge_chunks
```

Status: **18 sources scraped and cleaned; none ingested.** Cleaned files land
in `scraped/clean/`, *not* `knowledge/`, precisely because everything under
`knowledge/` is picked up automatically by the ingest script and nothing
machine-generated belongs on that path. Every cleaned file carries
`approved: false`, and the chunker's rejection of that state is the feature.

`manifest.ts` entries carry a `sourceId`; **`null` is load-bearing**, not an
oversight to patch by picking the nearest-looking ID — it states honestly that
no human has registered the publisher with adviser sign-off. `--chunks` on the
cleaner previews what the chunker would actually produce, which is the real
readiness test: a 900 KB clean document that yields four 200 KB chunks is
unusable no matter how clean its text is.

**Registration is not ingestion.** The 2026-08-10 migration registers nine new
publishers (NICE, KDOQI, ISN, APSN, PSH, GBD, CHEN2019, PHCOI, PHESRD) — that
only means a chunk *may be attributed* to them. Two category placements are
flagged in the migration as genuinely arguable and defensible rather than
buried: **ISN** (a capacity survey filed as `clinical_guideline` because ISN
is a peer nephrology body and the other two categories fit worse) and **APSN**
(published in a peer-reviewed journal but filed as `clinical_guideline`
because the document *is* a society guideline — same reasoning KDIGO gets).

⚠️ **PSH ≠ PSN.** Philippine Society of Hypertension vs Philippine Society of
Nephrology — two societies, adjacent acronyms. Attributing a blood-pressure
figure to PSN because the IDs look alike is a provenance error the citation
layer cannot catch. A dedicated test asserts they stay distinct.

---

## 9. Tests

Deno test suite in [tests/](../tests/). **Current status: 212 passed, 0
failed, 8 ignored** (the ignored ones are live tests that auto-skip without
API keys).

| File | Covers |
|---|---|
| `gate_test.ts`, `gate_provider_test.ts` | Injection battery, regex finality, Groq→Gemini→fail-open ordering |
| `scope_deflection_test.ts` | Off-topic deflection |
| `rerank_test.ts` | Threshold, top-N, cosine fallback on missing key/API failure |
| `rag_content_test.ts` | Delimiter integrity, untrusted-text neutralization |
| `output_guard_test.ts` | Prompt leakage, rule-change claims, citation checks |
| `topic_filter_test.ts` | Diagnostic-language blocking |
| `answer_cache_test.ts` | Normalization, both tiers, scope isolation |
| `scored_test.ts`, `screening_flow_test.ts` | SCORED scoring and the state machine |
| `chunker_test.ts`, `cleaner_test.ts`, `firecrawl_test.ts`, `tavily_test.ts` | Knowledge pipeline |
| `sources_test.ts` | Approved-source set, PSH/PSN distinctness, categories |
| `prompts_test.ts` | System-prompt invariants |
| `retrieval_live_test.ts` | Live retrieval relevance (skipped without keys) |

---

## 10. Commands

```sh
deno task test            # offline suite (live tests auto-skip without keys)
deno task test:live       # full live suite (uses .env)
deno task check           # type-check all Edge Functions + scripts
deno task check:providers # verify every provider/model with a real call
                          # (-- --skip-gemini to spend no Gemini quota)

deno task scrape:plan     # no network; prints what a scrape would fetch
deno task scrape          # Firecrawl → scraped/raw/  (SPENDS CREDITS)
                          # falls back to Tavily automatically;
                          # SCRAPE_PROVIDER=tavily to skip Firecrawl
deno task clean           # scraped/raw/ → scraped/clean/  (offline)
deno task ingest:dry      # chunk stats, no network, no DB

# ⛔ checkpoint-gated (spec §8) — explicit approval required
npx supabase db push
deno task ingest
npx supabase functions deploy general-chat clarify screening
```

Server secrets live in `.env` (gitignored; template in
[.env.example](../.env.example)). Browser-safe config lives in
`frontend/.env`.

---

## 11. Current state and known gaps

**Working and tested.** All three Edge Functions, the shared pipeline, the
two-tier cache, the scoring engine and state machine, the frontend, and the
212-test offline suite.

**In flight.**

- 18 of the Top-20 sources are scraped and cleaned but **not curated, not
  approved, and not ingested**. The live corpus is still the nine original
  documents / 34 chunks.
- `20260810145929_register_top20_sources.sql` is written but untracked —
  registration only; no chunk from those publishers exists yet.
- Two source registrations (ISN, APSN) carry category placements the
  manuscript will need to defend; the alternative honest fix is widening the
  category vocabulary rather than restating what the documents are.

**Known operational notes.**

- `COHERE_API_KEY` was unset as of 2026-08-06, which puts the reranker on its
  degraded cosine path — that is why `fallbackSimilarity` is currently
  load-bearing on the clarification route. Setting the key restores
  `rerankThreshold` (0.45, genuinely stricter than general education's 0.30)
  as the real gate.
- `ALLOWED_ORIGIN` must be set before any production deploy, or CORS falls
  back to `*`.
- TAM and TiMT item wordings need verbatim alignment with the manuscript
  before the evaluation study.
- `knowledge/REVIEW-FLAGS.md` still carries unresolved clinical items
  requiring adviser sign-off; PSA-cited content must carry the ICD cause-group
  caveat (PSA reports "nephritis, nephrotic syndrome and nephrosis", which is
  *not* coextensive with CKD — any PSA figure is a floor, not a total).
