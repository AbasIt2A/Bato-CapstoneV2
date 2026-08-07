-- BATO — Hardened RAG retrieval tier, delta: semantic answer cache
--
-- DRAFT migration. DO NOT APPLY without explicit checkpoint approval.
--
-- ===== WHY THIS TABLE EXISTS =====
--
-- Google's Gemini free tier meters generateContent at 20 requests per day
-- PER PROJECT PER MODEL. Answer generation is the one stage of the pipeline
-- that cannot be moved off Gemini or made cheaper by tuning: the input gate
-- has moved to Groq and retrieval runs on embeddings (a separate quota) plus
-- Cohere, but every genuinely new question still costs one generation call.
--
-- What makes a cache worth building rather than merely tempting is the
-- USAGE SHAPE of an evaluation study. Participants work from a common task
-- script and a shared vocabulary, so a cohort asks a few dozen distinct
-- questions in a few hundred phrasings — "what is CKD", "what's chronic
-- kidney disease", "can you explain CKD". Those are the same retrieval, the
-- same chunks and the same answer; paying Gemini separately for each is
-- spending the study's scarcest resource on restating work already done.
--
-- Matching is SEMANTIC, not textual, for that reason: a lexical key would
-- miss every re-phrasing, which is precisely the traffic worth catching. The
-- query embedding already exists at this point in the request (retrieval
-- needs it regardless), so a cache probe costs one extra vector search
-- against a small table and no additional API call of any kind.
--
-- ===== WHAT MAY AND MAY NOT BE STORED =====
--
-- Only a reply that survived the FULL pipeline — rerank threshold, the
-- diagnostic-language filter, and the output guard — is ever written here.
-- Deflections in particular are never cached, and that rule is load-bearing
-- rather than an optimisation: a deflection is frequently the symptom of a
-- transient failure (quota exhaustion, a provider timeout, a reranker
-- hiccup), and caching one would promote a temporary outage into a permanent
-- wrong answer for every future phrasing near it. Deflections are also free
-- to recompute, so there is nothing to gain. Enforcement is in the
-- application (see _shared/answer-cache.ts); this file records the contract.
--
-- The cache is a performance and cost layer ONLY. It sits behind the input
-- gate, never in front of it, so a cached reply cannot be reached by a
-- message the gate would have blocked.

-- ---------------------------------------------------------------------------
-- answer_cache — grounded replies keyed by query embedding
--
-- embedding is vector(768) to match gemini-embedding-001's requested
-- outputDimensionality, identical to knowledge_chunks. The two must change
-- together: a cache probe and the retrieval it substitutes for have to be
-- measured in the same space, or the similarity numbers mean nothing.
-- ---------------------------------------------------------------------------
create table public.answer_cache (
  id uuid primary key default gen_random_uuid(),

  -- Which chatbot produced this answer. A cache entry is NEVER visible
  -- across scopes: the two chatbots run different corpora, different
  -- thresholds and different system prompts, so a clarification-engine reply
  -- served into general chat (or the reverse) would be a scope leak with a
  -- cosine score attached. Filtered structurally inside the RPC below, the
  -- same way match_knowledge_chunks filters chunk scope.
  scope text not null check (
    scope in ('general_education', 'screening_clarification')
  ),

  -- The exact text that was embedded, kept for auditing: it is the only way
  -- to review after the fact what a stored entry will answer FOR. Not used
  -- for matching.
  question text not null,

  embedding extensions.vector(768) not null,

  -- The generated reply, verbatim as it was served, and the citations that
  -- accompanied it. Stored together because a reply's citations are part of
  -- the answer's correctness, not decoration — replaying one without the
  -- other would show a grounded answer with no provenance.
  reply text not null,
  sources jsonb not null default '[]'::jsonb,

  -- Generation model that produced the reply. Diagnostic: makes it possible
  -- to invalidate entries from one model without clearing the whole cache.
  model text,

  -- Study telemetry. hit_count is what turns "we added a cache" into a
  -- reportable hit rate for the manuscript's methods section.
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

comment on table public.answer_cache is
  'Semantic cache of fully-guarded grounded replies, keyed by query '
  'embedding and partitioned by retrieval scope. Exists to keep repeated '
  'phrasings of the same question from each costing a Gemini generation '
  'call, which the free tier meters at 20/day per model. Deflections are '
  'never stored. Read and written server-side via the service role only.';

comment on column public.answer_cache.scope is
  'Retrieval scope that produced this answer. Enforced as a structural '
  'filter inside match_answer_cache — a cache entry is never visible to the '
  'other chatbot.';

comment on column public.answer_cache.question is
  'The exact text embedded to produce this row''s vector. Audit trail only; '
  'matching is by cosine distance, never by this string.';

-- Same index choice and reasoning as knowledge_chunks: a small, read-heavy
-- table with no training step to tune, so HNSW rather than IVFFlat. This
-- table does grow at runtime (unlike the corpus, which is written only by
-- the approved ingestion script), but at study volumes it stays in the
-- thousands of rows — well inside the range where HNSW needs no attention.
create index answer_cache_embedding_idx
  on public.answer_cache
  using hnsw (embedding extensions.vector_cosine_ops);

-- Supports scope-filtered scans and manual pruning by age.
create index answer_cache_scope_created_idx
  on public.answer_cache (scope, created_at desc);

-- ---------------------------------------------------------------------------
-- match_answer_cache — scope-filtered nearest cached answer
--
-- Returns AT MOST ONE row: the single closest entry within scope that clears
-- match_threshold. A cache lookup is not a recall problem — there is no
-- reranking stage behind it to sort out a candidate pool, and the reply is
-- served verbatim — so returning a list would only invite the caller to pick
-- wrongly. The threshold lives with the caller (see scopes.ts), which owns
-- every other retrieval parameter.
-- ---------------------------------------------------------------------------
create or replace function public.match_answer_cache(
  query_embedding extensions.vector(768),
  match_threshold float,
  match_scope text
)
returns table (
  id uuid,
  question text,
  reply text,
  sources jsonb,
  similarity float
)
language sql
stable
-- Explicit even though it matches the Postgres default: pins the property so
-- it survives future edits instead of relying on an implicit default.
security invoker
-- Pin the search path: the <=> operator lives in the extensions schema,
-- which is not on the default migration/caller search_path.
set search_path = ''
as $$
  select
    ac.id,
    ac.question,
    ac.reply,
    ac.sources,
    1 - (ac.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.answer_cache ac
  -- Scope first, as in match_knowledge_chunks: an unrecognised match_scope
  -- matches nothing and the caller simply treats it as a miss. Fail-closed
  -- is the right direction — a typo costs one generation call, never a
  -- cross-chatbot answer.
  where ac.scope = match_scope
    and 1 - (ac.embedding operator(extensions.<=>) query_embedding)
      >= match_threshold
  order by ac.embedding operator(extensions.<=>) query_embedding
  limit 1;
$$;

comment on function public.match_answer_cache is
  'Nearest cached reply within one retrieval scope, or no row when nothing '
  'clears match_threshold. Callers treat every failure mode — no row, an '
  'error, a missing table — identically as a cache miss and regenerate.';

-- ---------------------------------------------------------------------------
-- touch_answer_cache — record a hit
--
-- A separate call rather than folding the update into match_answer_cache:
-- that function is STABLE and used on the read path, and making it VOLATILE
-- so it could write would mean every lookup takes a row lock. Callers invoke
-- this fire-and-forget after serving, so a failure to record telemetry can
-- never affect a user-visible reply.
-- ---------------------------------------------------------------------------
create or replace function public.touch_answer_cache(cache_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.answer_cache
  set hit_count = hit_count + 1,
      last_hit_at = now()
  where id = cache_id;
$$;

comment on function public.touch_answer_cache is
  'Increments hit_count and stamps last_hit_at for one cache entry. Called '
  'fire-and-forget after a cached reply is served; supplies the cache hit '
  'rate reported in the evaluation.';

-- Least privilege: Postgres grants EXECUTE to PUBLIC by default on new
-- functions, which would let anon/authenticated PostgREST callers invoke
-- these directly and bypass the input gate entirely — reading out cached
-- answers, or inflating hit counts, without passing a single guard. RLS
-- already filters their SELECT to zero rows, but the ungated surface is
-- unnecessary.
revoke all on function public.match_answer_cache(
  extensions.vector(768), float, text
) from public, anon, authenticated;

grant execute on function public.match_answer_cache(
  extensions.vector(768), float, text
) to service_role;

revoke all on function public.touch_answer_cache(uuid)
  from public, anon, authenticated;

grant execute on function public.touch_answer_cache(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- Same posture as knowledge_chunks and knowledge_sources: enabled with NO
-- policies, so every browser-facing role is denied by default and only the
-- service role (the Edge Functions) reaches it.
-- ---------------------------------------------------------------------------
alter table public.answer_cache enable row level security;
