-- BATO — Hardened RAG retrieval tier: knowledge_chunks (General CKD Chatbot only)
--
-- DRAFT migration. DO NOT APPLY without explicit checkpoint approval (spec
-- §2, §10). This is a fresh, standalone project, so the two-migration
-- history from the reference implementation (base table, then a heading_path
-- hardening delta) is consolidated here into ONE clean create-table
-- migration — there is no live table to ALTER.
--
-- Scope guardrails (mirror the manuscript's grounding constraints, spec §3.3):
--   * Only the General CKD Chatbot's retrieval path reads this table. The
--     Rule-Based Screening Controller and the LLM Clarification Engine never
--     touch it.
--   * Rows are sourced ONLY from the approved list — DOH, PSN, WHO, CDC,
--     NIDDK, KDIGO, AstraZeneca, SCORED — the same whitelist enforced in
--     supabase/functions/_shared/sources.ts. The `source` column CHECK
--     constraint makes an off-manuscript chunk physically unstorable.
--   * Retrieval runs server-side via the service role only. RLS is enabled
--     with NO policies, so every browser-facing role is denied by default.

-- ---------------------------------------------------------------------------
-- pgvector extension
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- knowledge_chunks — retrievable RAG-tier chunks
--
-- embedding is vector(768) to match Gemini gemini-embedding-001's requested
-- outputDimensionality (see supabase/functions/_shared/embeddings.ts). If the
-- embedding model or dimension ever changes, this column, the embeddings
-- module's EMBEDDING_DIMENSION constant, and every ingested row must all
-- change together (full re-ingestion required).
-- ---------------------------------------------------------------------------
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),

  -- Must be one of the approved manuscript sources (keep in sync with
  -- supabase/functions/_shared/sources.ts APPROVED_SOURCE_IDS). Prevents
  -- ingesting off-scope or invented material — enforced at the database
  -- layer, not just in application code.
  source text not null check (
    source in (
      'DOH', 'PSN', 'WHO', 'CDC', 'NIDDK', 'KDIGO', 'AstraZeneca', 'SCORED'
    )
  ),

  title text not null,

  -- Heading breadcrumb of the source Markdown section, "H1 > H2 [> H3]"
  -- (e.g. "CKD Stages > Stages of CKD > Stage 3"). Populated by
  -- scripts/chunker.ts + scripts/ingest-knowledge.ts; used for provenance
  -- display, not filtering.
  heading_path text,

  content text not null,

  embedding extensions.vector(768) not null,

  -- Topic tags for auditing/filtering the retrieval surface, e.g.
  -- {'ckd','stages','egfr'}. Sourced from each knowledge/*.md file's
  -- front-matter `topic_tags` list.
  topic_tags text[] not null default '{}',

  last_updated timestamptz not null default now()
);

comment on table public.knowledge_chunks is
  'RAG-tier grounding chunks for the General CKD Chatbot only (hardened RAG '
  'spec §3, §10). source is constrained to the approved manuscript '
  'whitelist. Read exclusively server-side via the service role.';

comment on column public.knowledge_chunks.source is
  'Attributable source ID, CHECK-constrained to the adviser-approved list. '
  'Every stored chunk must be traceable to a named authority (spec §3.3).';

comment on column public.knowledge_chunks.heading_path is
  'Heading breadcrumb of the source Markdown section, "H1 > H2 [> H3]" '
  '(e.g. "CKD Stages > Stages of CKD > Stage 3"). Populated by the chunker; '
  'used for provenance display, not filtering.';

-- Approximate-nearest-neighbour index for cosine similarity. HNSW is chosen
-- over IVFFlat: this is a small, read-heavy corpus (a handful of curated
-- markdown sources, re-ingested only via the one-time human-approved
-- script), so there is no benefit to IVFFlat's list-count training/tuning
-- step, and HNSW gives good recall with no training required.
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create index knowledge_chunks_topic_tags_idx
  on public.knowledge_chunks using gin (topic_tags);

-- ---------------------------------------------------------------------------
-- match_knowledge_chunks — cosine similarity search RPC
--
-- Returns the top-k chunks whose cosine similarity to the query embedding is
-- at least match_threshold. Similarity is 1 - cosine_distance, so it ranges
-- 0..1 (higher = closer). The Edge Function owns the threshold value and
-- passes it in as a parameter; this function only enforces it (no
-- user-supplied SQL — this RPC is called with parameterized arguments only,
-- per spec §3.2 least-privilege).
-- ---------------------------------------------------------------------------
create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  source text,
  title text,
  heading_path text,
  content text,
  topic_tags text[],
  similarity float
)
language sql
stable
-- Explicit even though it matches the Postgres default: pins the property
-- so it survives future edits instead of relying on an implicit default.
security invoker
-- Pin the search path: the <=> operator lives in the extensions schema,
-- which is not on the default migration/caller search_path.
set search_path = ''
as $$
  select
    kc.id,
    kc.source,
    kc.title,
    kc.heading_path,
    kc.content,
    kc.topic_tags,
    1 - (kc.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.knowledge_chunks kc
  where 1 - (kc.embedding operator(extensions.<=>) query_embedding)
    >= match_threshold
  order by kc.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

comment on function public.match_knowledge_chunks is
  'Cosine top-k retrieval for the General CKD Chatbot. Called by the '
  'general-chat Edge Function with the service role; threshold and k are '
  'supplied by the caller (a named, adjustable relevance threshold — spec '
  '§12 step 3). Returns heading_path so replies can show the KB breadcrumb '
  'of each fact.';

-- Least privilege (spec §3.2): Postgres grants EXECUTE to PUBLIC by default
-- on new functions, which would let anon/authenticated PostgREST callers
-- invoke this RPC directly, bypassing the gate/rerank pipeline. RLS already
-- filters their SELECT to zero rows (SECURITY INVOKER + no policies), so
-- that is not a data leak — but the ungated compute surface is unnecessary.
-- Only the service role (the Edge Function) may execute it.
revoke all on function public.match_knowledge_chunks(
  extensions.vector(768), float, int
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks(
  extensions.vector(768), float, int
) to service_role;

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- Grounding content is server-only. RLS is enabled with NO client policies:
-- deny-by-default blocks all browser/anon/authenticated access, while the
-- service role (used only by the Edge Function and the one-time ingestion
-- script) bypasses RLS entirely.
-- ---------------------------------------------------------------------------
alter table public.knowledge_chunks enable row level security;
