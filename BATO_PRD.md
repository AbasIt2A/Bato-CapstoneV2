# Product Requirements Document (PRD)
## BATO — Bridging Awareness Through Online Risk Assessment

| | |
|---|---|
| **Project** | BATO: CKD Risk Screening and Information System |
| **Institution** | University of the Immaculate Conception (UIC), College of Computer Studies, Davao City |
| **Phase** | Capstone 2 — System Development |
| **Stack** | React (frontend) + Supabase (backend/DB/auth) |
| **Clinical Foundation** | SCORED Instrument (Bang et al., 2007), licensed from AstraZeneca Philippines — Veeva Approval ID: PH-6850 |
| **Document Status** | Development-ready draft. Sections marked ⚠️ **CONFIRM** should be checked against the final approved manuscript before being treated as ground truth. |

---

## 1. Executive Summary

BATO is a web-based Chronic Kidney Disease (CKD) risk screening and information system. It uses the validated **SCORED instrument** to produce a deterministic, rule-based CKD risk classification, and pairs it with two purpose-built conversational assistants: one that guides the user through the screening itself in plain language, and one that answers general CKD questions. The system is not a diagnostic tool — it is a screening and awareness tool that directs Screen Positive users toward confirmatory testing with a health professional.

---

## 2. Problem Statement

CKD is frequently under-diagnosed because at-risk individuals are not routinely tested, and public awareness of CKD risk factors is low. Existing screening happens almost exclusively inside clinical settings and depends on a health worker initiating it. BATO addresses this by making a validated screening instrument (SCORED) available directly to laypersons online, with plain-language clarification support so a non-clinical user can understand *why* each question is being asked and what their result means — without the system ever replacing an actual medical diagnosis.

---

## 3. Goals & Objectives

⚠️ **CONFIRM** exact wording against the approved manuscript (three objectives, per your Capstone 2 revision). Working draft based on system scope:

1. **Design and develop** a web-based CKD risk screening system that implements the SCORED instrument through a two-chatbot architecture (Risk Assessment Chatbot + General CKD Chatbot).
2. **Implement** an LLM-assisted clarification layer that simplifies clinical terminology during screening and answers general CKD questions, grounded strictly in a curated, credible knowledge base (PSN, DOH, WHO, AstraZeneca Philippines, CDC, NIDDK, KDIGO).
3. **Evaluate** the system's usability and acceptability using the System Usability Scale (SUS, n≥20), the Technology Acceptance Model (TAM), and Trust in Medical Technology (TiMT) instruments.

---

## 4. Target Users

- **Primary:** General public / laypersons in the Philippines with no clinical background, self-screening for CKD risk.
- **Secondary:** Individuals already aware of risk factors (e.g., diabetic or hypertensive patients) seeking a low-friction way to check their risk level.
- **Out of scope for v1:** Clinicians as primary users, though the tool may be used *by* laypersons at the suggestion of a health worker.

---

## 5. Scope

### 5.1 In Scope
- SCORED-based sequential risk screening flow (9 variables)
- Deterministic score computation and binary classification (Screen Negative / Screen Positive)
- Risk Assessment Chatbot (Rule-Based Screening Controller + LLM Clarification Engine)
- General CKD Chatbot (free-form, topic-constrained)
- Curated knowledge base for LLM grounding (system-prompt based)
- Result presentation with next-step guidance (confirmatory testing recommendation)
- Usability/evaluation instrumentation (SUS, TAM, TiMT capture)
- Basic user session/history (optional, see §11)

### 5.2 Out of Scope (v1)
- Clinical diagnosis or treatment planning
- Storage/processing of actual lab results (e.g., serum creatinine values)
- Integration with hospital EMRs
- Multi-language support beyond English/Filipino (unless separately scoped)
- Full RAG pipeline (v1 uses system-prompt-based grounding, not vector retrieval — see §9)

---

## 6. System Architecture

### 6.1 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React | SPA; component-based; recommend React Router for navigation |
| Backend / DB | Supabase (PostgreSQL) | Auth, database, row-level security |
| Serverless logic | Supabase Edge Functions | Proxy for LLM API calls — **never call the LLM API directly from the client**, to protect the API key and to enforce server-side grounding/system prompts |
| LLM Provider | ⚠️ **CONFIRM** — not yet specified in prior sessions. Recommend deciding explicitly (e.g., Anthropic Claude API) before coding the Edge Functions, since prompt formatting and function/tool-calling syntax differ by provider. |
| Hosting | ⚠️ **CONFIRM** (e.g., Vercel/Netlify for frontend, Supabase Cloud for backend) |

### 6.2 High-Level Architecture

```
┌─────────────────────────────┐
│         React Frontend       │
│  ┌────────────┐ ┌──────────┐ │
│  │ Risk Assess.│ │ General  │ │
│  │ Chat UI     │ │ Chat UI  │ │
│  └─────┬──────┘ └────┬─────┘ │
└────────┼─────────────┼───────┘
         │             │
         ▼             ▼
┌─────────────────────────────┐
│     Supabase Edge Functions  │
│  ┌────────────────────────┐  │
│  │ Rule-Based Screening    │  │  ← deterministic, owns SCORED flow + scoring
│  │ Controller              │  │
│  │   └─▶ LLM Clarification │  │  ← side-branch, invoked on demand only
│  │        Engine           │  │     (terminology simplification, NOT scoring)
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ General CKD Chatbot     │  │  ← free-form, topic-constrained by system prompt
│  │ (LLM, grounded)         │  │
│  └────────────────────────┘  │
└──────────┬───────────────────┘
           ▼
┌─────────────────────────────┐
│   Supabase Postgres (DB)     │
│  users, assessments,          │
│  responses, chat_logs,        │
│  evaluation_responses         │
└─────────────────────────────┘
```

### 6.3 Two-Chatbot Architecture (Critical Design Constraint)

This is the core architectural decision from the defense panel revision. **Do not merge these two chatbots** — they have incompatible interaction models (strict sequential state machine vs. open-ended conversation), and merging them was explicitly identified as a source of avoidable complexity.

**A. Risk Assessment Chatbot** (hybrid rule-based + LLM)
- **Rule-Based Screening Controller**: owns the entire SCORED flow. It is a deterministic state machine that asks the 9 SCORED variables in sequence, validates input, computes the score, and returns the classification. **The LLM must never be on the score-computation path** — this was a specific defensibility requirement from the panel (reduces hallucination risk).
- **LLM Clarification Engine**: a side-branch, not a pipeline step. When a user asks "what does anemia mean?" mid-flow, control delegates to the LLM Clarification Engine for a plain-language explanation, then **returns control to the Rule-Based Screening Controller** at the same point in the flow. It does clinical terminology simplification only, grounded by the curated knowledge base — it does not ask questions, score, or advance the flow itself.

**B. General CKD Chatbot** (LLM only)
- Free-form conversational assistant.
- Constrained via system prompt to CKD-related topics only (should decline or redirect off-topic queries).
- Draws from the same curated knowledge base as the Clarification Engine.
- No connection to the scoring logic.

---

## 7. Clinical Foundation — SCORED Instrument

### 7.1 Variables & Point Values (source: Bang et al., 2007, Table 2)

| # | Variable | Condition | Points |
|---|---|---|---|
| 1 | Age | 50–59 years | 2 |
| | | 60–69 years | 3 |
| | | ≥70 years | 4 |
| | | <50 years | 0 |
| 2 | Sex | Female | 1 |
| 3 | Anemia | History of anemia | 1 |
| 4 | Hypertension | Has high blood pressure | 1 |
| 5 | Diabetes | Diabetic | 1 |
| 6 | History of cardiovascular disease | Heart attack or stroke | 1 |
| 7 | History of congestive heart failure | CHF/heart failure history | 1 |
| 8 | Peripheral vascular disease | Circulation disease in legs | 1 |
| 9 | Proteinuria | Protein in urine (if known) | 1 |

Age is a single variable with tiered scoring; the other 8 are binary (present = listed points, absent = 0). Maximum possible score = 12, though scores of 10–12 are pooled for reporting purposes in the original study.

### 7.2 Classification Logic (deterministic — implement as pure function, not LLM)

```
total_score = age_points + female(1/0) + anemia(1/0) + hypertension(1/0)
            + diabetes(1/0) + cvd_history(1/0) + chf_history(1/0)
            + pvd(1/0) + proteinuria(1/0)

if total_score >= 4:
    result = "Screen Positive"
else:  # 0-3
    result = "Screen Negative"
```

⚠️ This is a **binary classifier only** (Screen Negative / Screen Positive at cutoff 4). Per your key learnings, do **not** implement a three-tier Low/Moderate/High model — this was explicitly corrected in the manuscript.

At cutoff ≥4: sensitivity 92%, specificity 68%, PPV 18%, NPV 99% (internal validation, Bang et al. 2007). These are useful for the system's "About the accuracy of this screening" info panel but should be presented as instrument-level statistics, not per-user probabilities.

### 7.3 Result Messaging Requirements
- **Screen Positive:** clearly state this is a screening result, not a diagnosis, and recommend confirmatory serum creatinine testing with a health professional.
- **Screen Negative:** state that CKD is unlikely at present but recommend re-screening periodically (the original instrument suggests annually), since a negative score does not rule out future risk.
- Never state or imply a percentage likelihood of the *individual* having CKD beyond what the validated PPV/NPV figures support, and always frame them as population-level statistics.

### 7.4 Licensing
SCORED is used under license from AstraZeneca Philippines (Veeva Approval ID: PH-6850). Any user-facing questionnaire wording should be your own paraphrased implementation, not a verbatim reproduction of the original published questionnaire (Figure 2 in the source paper) — confirm the exact permitted-use terms of the AstraZeneca license before finalizing UI copy.

---

## 8. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | User can start a Risk Assessment session without account creation (or with optional account — ⚠️ CONFIRM auth requirement) | Must |
| FR-2 | Rule-Based Screening Controller presents the 9 SCORED variables sequentially, one at a time, with validated input | Must |
| FR-3 | User can, at any point during screening, ask a clarifying question about the current term; control delegates to LLM Clarification Engine and returns to the same flow step afterward | Must |
| FR-4 | System computes the SCORED total via deterministic function (no LLM in the computation path) | Must |
| FR-5 | System displays binary classification (Screen Negative / Screen Positive) with appropriate next-step messaging (§7.3) | Must |
| FR-6 | User can access the General CKD Chatbot independently of the assessment flow | Must |
| FR-7 | General CKD Chatbot declines or redirects off-topic (non-CKD) queries | Must |
| FR-8 | Both chatbots ground responses in the curated knowledge base (PSN, DOH, WHO, AstraZeneca PH, CDC, NIDDK, KDIGO) via system-prompt constraints | Must |
| FR-9 | System captures SUS, TAM, and TiMT evaluation responses from test participants | Must |
| FR-10 | Assessment results and chat sessions are logged for evaluation purposes (with consent) | Should |
| FR-11 | Admin/content-owner can update the knowledge base content used for grounding | Should |
| FR-12 | System is responsive across desktop and mobile viewports | Should |
| FR-13 | User can restart/retake the assessment | Could |

---

## 9. LLM Integration & Grounding Strategy

- **Method:** System-prompt-based constraint, **not** full RAG (retrieval-augmented generation with vector search). This was a deliberate scope decision given timeline/stack constraints — the panel's reference to NotebookLM was interpreted as a source-credibility model, not a technical RAG requirement.
- **Implementation:** The curated knowledge base content (from PSN, DOH, WHO, AstraZeneca Philippines, CDC, NIDDK, KDIGO) should be distilled into a structured system prompt (or a small number of reference documents injected into context) that both the Clarification Engine and General CKD Chatbot draw from. Keep the source list and core facts version-controlled so grounding content can be audited.
- **Guardrails to implement:**
  - System prompt must explicitly instruct the model to stay within CKD-related topics for the General Chatbot.
  - System prompt must explicitly instruct the Clarification Engine to explain, not score or advance the flow.
  - Model responses should avoid diagnostic language ("you have CKD") — screening/informational framing only.
  - Consider a light server-side check (e.g., keyword/topic filter) as a second layer before LLM output is returned, especially for the General Chatbot.

---

## 10. Data Model (Supabase / Postgres — draft)

```sql
-- Users (optional, if accounts are implemented)
users (
  id uuid primary key,
  created_at timestamptz,
  ...  -- Supabase Auth handles core identity fields
)

-- One row per completed or in-progress screening
assessments (
  id uuid primary key,
  user_id uuid references users(id) null,  -- nullable if anonymous use allowed
  started_at timestamptz,
  completed_at timestamptz,
  total_score int,
  classification text check (classification in ('Screen Negative','Screen Positive')),
  status text check (status in ('in_progress','completed','abandoned'))
)

-- Individual SCORED variable responses per assessment
assessment_responses (
  id uuid primary key,
  assessment_id uuid references assessments(id),
  variable_key text,      -- e.g. 'age', 'female', 'anemia', ...
  value_raw text,         -- raw user input
  points_awarded int
)

-- Chat logs for both chatbots
chat_sessions (
  id uuid primary key,
  user_id uuid references users(id) null,
  assessment_id uuid references assessments(id) null,  -- non-null only for Clarification Engine sessions
  chatbot_type text check (chatbot_type in ('risk_assessment_clarification','general_ckd')),
  started_at timestamptz
)

chat_messages (
  id uuid primary key,
  chat_session_id uuid references chat_sessions(id),
  role text check (role in ('user','assistant')),
  content text,
  created_at timestamptz
)

-- Evaluation instruments
evaluation_responses (
  id uuid primary key,
  user_id uuid references users(id) null,
  instrument text check (instrument in ('SUS','TAM','TiMT')),
  responses jsonb,     -- per-item Likert scores
  score numeric,       -- computed composite score
  submitted_at timestamptz
)
```

Apply Row-Level Security (RLS) on all tables holding personal or health-adjacent data — see §12.

---

## 11. Non-Functional Requirements

- **Accessibility:** WCAG 2.1 AA baseline recommended (health-facing public tool).
- **Performance:** Screening flow interactions should feel instant (rule-based, no LLM latency on the critical path); LLM-backed responses (Clarification Engine, General Chatbot) should show a loading/typing state given expected latency.
- **Responsiveness:** Mobile-first, given likely public/self-service usage patterns.
- **Reliability:** Scoring logic must be covered by unit tests given its clinical/defensibility importance (§13).
- **Browser support:** ⚠️ CONFIRM target browser matrix.

---

## 12. Compliance & Privacy

- CKD risk data and health-adjacent responses are sensitive personal information under the **Philippine Data Privacy Act of 2012 (RA 10173)**. Recommend:
  - Explicit consent screen before data collection, stating purpose (research/capstone evaluation) and retention.
  - Minimize retention — consider anonymizing or allowing anonymous assessment sessions.
  - Enforce Supabase RLS so users can only access their own records; service-role access restricted to server-side functions only.
  - No storage of actual lab/creatinine values (out of scope, §5.2) reduces sensitivity footprint.
- This is not medical advice — legal disclaimer language should appear on results and in the General Chatbot's scope boundaries.

---

## 13. Testing & Evaluation Plan

| Type | Method | Notes |
|---|---|---|
| Unit testing | Scoring function | Every SCORED variable combination against known expected totals/classifications — this is the most defensibility-critical piece of code in the system |
| Black-box testing | Per manuscript's Black-Box Testing section | Functional flow testing of both chatbots and the screening sequence |
| Usability | SUS | n ≥ 20 participants |
| Acceptance | TAM | Perceived usefulness / ease of use |
| Trust | TiMT | Trust in Medical Technology instrument |

---

## 14. Success Metrics

- Scoring function: 100% agreement with manually computed SCORED totals across test cases.
- SUS score within acceptable usability range (⚠️ CONFIRM target threshold, commonly ≥68 is "above average").
- TAM/TiMT results support the manuscript's Objective 3 evaluation claims.
- Both chatbots correctly stay within their scope boundaries during black-box testing (Clarification Engine never advances/scores; General Chatbot declines off-topic queries).

---

## 15. Open Decisions Before Coding Starts

1. **LLM provider** for the Edge Functions (Anthropic, OpenAI, other) — affects Edge Function implementation and system prompt format.
2. **Authentication model** — fully anonymous vs. optional/required accounts.
3. **Exact final wording of the three manuscript objectives** — align PRD §3 to it verbatim once available.
4. **Hosting targets** for frontend and Supabase project tier.
5. **Exact SCORED user-facing question wording** — must be your own paraphrase, reviewed against the AstraZeneca license terms, not the published Figure 2 text verbatim.

---

## 16. Appendix — SCORED Reference (Bang et al., 2007)

- Study: NHANES 1999–2002, N=8,530; external validation via ARIC study.
- Model AUC: 0.88 (internal), 0.71 (external).
- Cutoff ≥4 selected via Youden index comparison against cutoff 5 (0.60 vs 0.62), with cutoff 4 offering meaningfully higher sensitivity.
- CKD defined as GFR <60 mL/min/1.73m².
