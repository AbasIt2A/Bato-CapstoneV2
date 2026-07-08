# BATO — General CKD Information Chatbot (Hardened RAG)

Standalone implementation of the **Hardened RAG retrofit** for BATO's General CKD
Information Chatbot, per [BATO_Hardened_RAG_Prompt.md](BATO_Hardened_RAG_Prompt.md).
It replaces system-prompt grounding with retrieval-augmented generation over a
curated, adviser-approved markdown knowledge base stored in Supabase/pgvector,
behind a CKD-only scope guardrail and anti–prompt-injection defenses.

> **Scope note:** this project contains ONLY the General CKD Information Chatbot.
> The Risk Assessment Chatbot (SCORED screening controller + bounded Clarification
> Engine) is a separate system and is intentionally absent here.

## Pipeline

```
user message
   │
   ▼
[1] Input gate            regex pre-screen + gemini-2.5-flash-lite JSON verdict
    {in_scope, injection_detected, reason}    → off-topic/injection ⇒ deflect
   │
   ▼
[2] Embed query           Gemini gemini-embedding-001 (768-dim)
   │
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
```

## Layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | pgvector + `knowledge_chunks` table + `match_knowledge_chunks` RPC (deny-by-default RLS) |
| `knowledge/*.md` | Curated source documents (front-matter provenance + heading hierarchy). Approved sources only |
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
| `GEMINI_API_KEY` | gate, embeddings, generation | Google AI Studio key |
| `COHERE_API_KEY` | rerank | Cohere Rerank v3.5 (optional — cosine fallback if unset) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function, ingest script | Server-side DB access |
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
deno task check       # type-check the Edge Function + scripts
deno task ingest:dry  # ingestion dry-run (no network, no DB — chunk stats)

# ⛔ approval required beyond this point
npx supabase db push                     # apply migration
deno task ingest                         # embed + insert chunks (uses .env)
npx supabase functions deploy general-chat  # deploy the Edge Function
deno task test:live                      # full live suite (uses .env)
```
