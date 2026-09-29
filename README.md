# BATO — General CKD Information Chatbot (Hardened RAG)

Standalone implementation of the **Hardened RAG retrofit** for BATO's General CKD
Information Chatbot, per [BATO_Hardened_RAG_Prompt.md](BATO_Hardened_RAG_Prompt.md).
It replaces system-prompt grounding with retrieval-augmented generation over a
curated, adviser-approved markdown knowledge base stored in Supabase/pgvector,
behind a CKD-only scope guardrail and anti–prompt-injection defenses.

The frontend also includes the SCORED Risk Assessment flow. Its `screening` and
`clarify` Edge Functions use the same Supabase project as `general-chat`.

## Pipeline

```
user message
   │
   ▼
[1] Input gate            regex pre-screen + JSON verdict from Groq
                          (Gemini fallback) — keeps generation quota free
    {in_scope, injection_detected, reason}    → off-topic/injection ⇒ deflect
   │
   ▼
[2a] Answer cache tier 1  exact match on normalised question, scope-filtered
                          → HIT ⇒ serve stored reply, no LLM call, no embedding
   │ (miss)
   ▼
[2b] Embed query          gemini-embedding-001 (768-dim) ×2 in parallel:
                          RETRIEVAL_QUERY for [3], SEMANTIC_SIMILARITY for [2c]
   │
   ▼
[2c] Answer cache tier 2  match_answer_cache RPC, scope-filtered, cosine
                          ≥ 0.97 → HIT ⇒ serve stored reply, no LLM call
   │ (miss)
   ▼
[3] pgvector recall       match_knowledge_chunks RPC, top-K=20,
                          cosine floor 0.45 (VECTOR_SIMILARITY_FLOOR)
   │
   ▼
[4] Rerank                Cohere Rerank v3.5, keep top-N=4 with
                          relevance ≥ 0.30 (RERANK_THRESHOLD);
                          no key/API failure ⇒ cosine fallback (floor 0.60)
                          → nothing passes ⇒ deflect
   │
   ▼
[5] Grounded generation   system prompt = ONLY trusted instructions;
                          retrieved chunks + user question wrapped in
                          UNTRUSTED-DATA delimiters; every claim cites its source
   │
   ▼
[6] Output guard          heuristic check for prompt leakage / "rules changed"
                          claims / delimiter tokens → triggered ⇒ deflect
   │
   ▼
[7] Cache write           store the guarded reply — success path only, so a
                          deflection is never cached
```

### Free-tier quota budget

Gemini's free tier allows **20 `generateContent` requests per day, per project
per model**. Three design choices keep that from capping the system at ~10
messages/day:

| Stage | Provider / model | Bucket |
|---|---|---|
| Input gate | Groq `openai/gpt-oss-20b` | not Gemini at all |
| Input gate (fallback, only if Groq is unset/failing) | `gemini-3.5-flash` | bucket A |
| general-chat generation | `gemini-3.5-flash-lite` | bucket B |
| clarify generation | `gemini-3.1-flash-lite` | bucket C |
| Embeddings | `gemini-embedding-001` | separate, far larger quota |
| Rerank | Cohere `rerank-v3.5` | separate provider |

The three Gemini model names must stay distinct — two roles sharing a name
share one 20/day allowance. `deno task check:providers` warns if they collide,
and verifies every model with a real call (the `GET /models` listing is
optimistic and lists models a key cannot actually call).

### Why the answer cache is two tiers

Embedding similarity **cannot** safely decide whether two questions mean the
same thing on this corpus. Measured 2026-08-07:

| | RETRIEVAL_QUERY | SEMANTIC_SIMILARITY |
|---|---|---|
| same meaning, lowest | 0.729 | 0.885 |
| different meaning, highest | 0.863 | **0.925** |

The distributions overlap under both geometries. `"How do I prevent CKD?"` and
`"How do I treat CKD?"` score 0.925 — higher than the genuine paraphrase
`"Can you explain chronic kidney disease?"` / `"what does CKD mean"` at 0.885.
No threshold sits between them. The cause is structural: these embeddings
encode topic, while prevent/treat and curable/preventable are single operators
that barely move the vector yet completely change the correct answer.

So **tier 1 (exact match on normalised text)** carries the savings — zero
false-hit risk by construction, and it catches the dominant repeat pattern of a
scripted evaluation session. **Tier 2 (similarity)** sits above the entire
measured overlap at 0.97/0.98 and is a rare backstop by design. Lowering it to
chase hit rate re-introduces exactly the failure it was built to avoid.

## Layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | pgvector + `knowledge_chunks` table + `match_knowledge_chunks` RPC (deny-by-default RLS) |
| `knowledge/**/*.md` | Curated source documents (front-matter provenance + heading hierarchy), filed by inclusion-framework category: `official-health-body/<body>/`, `clinical-guidelines/<body>/`, `peer-reviewed/`. Approved sources only; the folder documents provenance, front-matter `source` still defines it |
| `knowledge/REVIEW-FLAGS.md` | Adviser-review ledger for diet/clinical-value content |
| `scripts/chunker.ts` | Pure markdown-header chunker (H2 boundaries, H3 kept with parent, small overlap on long sections) |
| `scripts/ingest-knowledge.ts` | One-time embed + insert script. **Checkpoint-gated — do not run without approval** |
| `supabase/functions/general-chat/` | The Edge Function implementing the pipeline above |
| `supabase/functions/_shared/` | gate, embeddings, retrieval, rerank, prompts, rag-content (trust delimiters), output-guard, sources whitelist |
| `tests/` | Deno test suite: gate/injection battery, scope deflection, rerank fallback, delimiter integrity, output guard, chunker, sources, optional live retrieval-relevance |
| `docs/manuscript-alignment.md` | Plain-language summary for the capstone manuscript (Phase 6) |

## Security model (spec §3)

- **CKD-only scope, three layers:** input gate → rerank relevance threshold → system-prompt refusal. Off-topic questions (even benign ones) get the approved deflection.
- **Trust separation:** the system prompt is the only instruction region. Retrieved chunks and the user question are wrapped in labeled `UNTRUSTED` delimiters and never concatenated into instructions; delimiter tokens inside untrusted text are neutralized.
- **Injection screening:** regex pre-screen (instruction-override, prompt-leak, role-swap, delimiter-break, role-prefix smuggling) plus a cheap model classifier. The gate fails open on API error — the retrieval threshold is the backstop; the regex verdict is always enforced.
- **Source integrity:** the `source` column is CHECK-constrained in Postgres to the approved list (DOH, PSN, WHO, CDC, NIDDK, KDIGO, AstraZeneca, SCORED); the chunker and ingest script reject anything else; RLS is deny-by-default (service-role reads only); all DB access is parameterized RPC.
- **Output guard:** heuristic post-check replaces leaking/compromised drafts with the deflection.

## Environment variables

| Var | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | embeddings, generation, gate fallback | Google AI Studio key |
| `GROQ_API_KEY` | gate | Groq key. Optional but strongly recommended — moves the gate off Gemini's 20/day quota |
| `COHERE_API_KEY` | rerank | Cohere Rerank v3.5 (optional — cosine fallback if unset) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function, ingest script | Server-side DB access |
| `GEMINI_MODEL` / `CLARIFY_GEMINI_MODEL` / `GATE_MODEL` | generation, gate | Per-role model overrides — **must stay three distinct models** |
| `GROQ_GATE_MODEL` | gate | Groq classifier model (default `openai/gpt-oss-20b`) |
| `GENERAL_CHAT_VARIATION_GROQ_API_KEY` | general chat | Optional key for cached-answer rewording and equivalence checks; falls back to `GROQ_API_KEY` |
| `ANSWER_CACHE_ENABLED` | answer cache | Set `false` to bypass the cache entirely (default on) |
| `CACHE_HIT_THRESHOLD` / `CLARIFY_CACHE_HIT_THRESHOLD` | answer cache | Tier-2 similarity floor (0.97 / 0.98). Set above the measured overlap — do not lower without re-measuring |
| `VECTOR_SIMILARITY_FLOOR` | retrieval | Override recall floor (default 0.45) |
| `RERANK_THRESHOLD` | rerank | Override relevance gate (default 0.30) |

## Running

**New here? Start with [SETUP.md](SETUP.md)** — the step-by-step,
beginner-friendly guide (what RAG is, where every key comes from, and the
exact commands). Secrets live in `.env` (gitignored; template in
[.env.example](.env.example)).

Everything marked ⛔ is **checkpoint-gated** (spec §8): do not apply the
migration, run ingestion, or deploy without explicit approval.

```sh
deno task test        # offline tests (live tests auto-skip without keys)
deno task check       # type-check the Edge Functions + scripts
deno task ingest:dry  # ingestion dry-run (no network, no DB — chunk stats)

# Verify every provider/model with a real call. Costs 1 request from each of
# three separate Gemini buckets; --skip-gemini checks only Groq/Cohere/embeddings.
deno task check:providers
deno task check:providers -- --skip-gemini

# ⛔ approval required beyond this point
npx supabase db push                     # apply migrations
deno task ingest                         # embed + insert chunks (uses .env)
npx supabase functions deploy general-chat screening clarify  # deploy the Edge Functions
deno task test:live                      # full live suite (uses .env)
```
