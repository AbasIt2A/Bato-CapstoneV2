-- BATO — Hardened RAG retrieval tier, delta: source register + retrieval scopes
--
-- Two changes, both required by the revised manuscript. Neither is cosmetic:
-- each replaces a structure that now contradicts a stated design claim.
--
--   1. SOURCE REGISTER (replaces the fixed CHECK on knowledge_chunks.source)
--
--      The manuscript replaced the fixed eight-source enumeration with a
--      source INCLUSION FRAMEWORK: three admissible categories, a currency
--      rule, adviser approval before ingestion, and a source register
--      finalised at submission recording each source's category, publication
--      or revision year, and approval date.
--
--      A hard-coded CHECK constraint cannot express that. It made every
--      newly approved source a schema migration — directly against the
--      framework's stated purpose ("so that coverage can be extended over
--      the course of development") — and the register itself had nowhere to
--      live. This replaces the CHECK with a knowledge_sources reference
--      table and a foreign key.
--
--      The physical guarantee is UNCHANGED and this is the point: a chunk
--      whose source is not registered still cannot be stored. Admitting a
--      source simply becomes a data operation with an audit trail instead of
--      a code change.
--
--   2. RETRIEVAL SCOPES (new knowledge_chunks.scopes)
--
--      Both chatbots now ground on this one table. The screening-clarification
--      corpus and the general CKD education corpus are separated by scope
--      metadata within a single pipeline rather than by separate
--      infrastructure.
--
--      Scope is enforced INSIDE the RPC as a structural constraint on the
--      query — never as an instruction handed to the language model, and
--      never as a filter the caller may omit. The old unscoped 3-argument
--      RPC is DROPPED rather than left as an overload: leaving it callable
--      would be a scope-bypass with a service-role grant already attached.
--
-- Supersedes the "General CKD Chatbot only" scoping asserted throughout
-- 20260708000001_knowledge_chunks.sql; those comments are refreshed at the
-- end of this file.

-- ---------------------------------------------------------------------------
-- 1. knowledge_sources — the source register
--
-- One row per source admitted under the inclusion framework. This IS the
-- source register the manuscript requires at submission; it is not a
-- convenience lookup table.
-- ---------------------------------------------------------------------------
create table public.knowledge_sources (
  -- Stable citation ID stored on knowledge_chunks.source and shown to users.
  id text primary key,

  name text not null,

  -- The three admissible categories of the inclusion framework. Material
  -- that fits none of them is inadmissible by definition, so this stays a
  -- CHECK: the category set is a claim of the manuscript, not data that
  -- grows during development.
  category text not null check (
    category in (
      'official_health_body',  -- DOH, PSN, WHO, CDC, NIDDK, licensed publishers
      'clinical_guideline',    -- KDIGO and peer nephrology/allied bodies
      'peer_reviewed'          -- indexed, editorially peer-reviewed literature
    )
  ),

  -- Prevailing edition for a guideline, publication year for literature.
  -- Supports the currency rule (10 years for journal literature unless the
  -- work is foundational to the instrument itself — e.g. SCORED, 2007).
  publication_year int check (publication_year between 1900 and 2100),

  -- Adviser sign-off is a precondition of ingestion. NULL means "registered
  -- but not yet approved"; scripts/ingest-knowledge.ts refuses those rows,
  -- so registration alone is not sufficient to get content into the corpus.
  adviser_approved_on date,

  -- Retire a source without deleting the chunks that cite it (the FK below
  -- is ON DELETE RESTRICT, so deletion is not the retirement mechanism).
  is_active boolean not null default true,

  added_on timestamptz not null default now()
);

comment on table public.knowledge_sources is
  'Source register for the shared RAG corpus. One row per source admitted '
  'under the manuscript''s three-category inclusion framework, carrying its '
  'category, publication/revision year and adviser approval date. '
  'knowledge_chunks.source is a foreign key onto this table, so an '
  'unregistered source remains physically unstorable — the same guarantee '
  'the previous CHECK constraint gave, without freezing the list in schema.';

comment on column public.knowledge_sources.adviser_approved_on is
  'Date of adviser approval. NULL = registered but not approved; the '
  'ingestion script refuses to ingest chunks attributed to such a source.';

-- Seed with the eight sources already approved and ingested. Categories per
-- the framework; AstraZeneca Philippines is an official body here in its
-- capacity as the licensed publisher of the SCORED patient questionnaire,
-- while SCORED itself is the underlying peer-reviewed instrument.
insert into public.knowledge_sources
  (id, name, category, publication_year, adviser_approved_on)
values
  ('DOH', 'Department of Health (Philippines)',
   'official_health_body', null, '2026-07-08'),
  ('PSN', 'Philippine Society of Nephrology',
   'official_health_body', 2024, '2026-07-08'),
  ('WHO', 'World Health Organization',
   'official_health_body', null, '2026-07-08'),
  ('CDC', 'US Centers for Disease Control and Prevention',
   'official_health_body', null, '2026-07-08'),
  ('NIDDK', 'National Institute of Diabetes and Digestive and Kidney Diseases',
   'official_health_body', null, '2026-07-08'),
  ('KDIGO', 'Kidney Disease: Improving Global Outcomes',
   'clinical_guideline', 2024, '2026-07-08'),
  ('AstraZeneca', 'AstraZeneca Philippines',
   'official_health_body', 2022, '2026-07-08'),
  ('SCORED', 'Bang et al., 2007 (SCORED study, JAMA Internal Medicine)',
   'peer_reviewed', 2007, '2026-07-08');

-- ---------------------------------------------------------------------------
-- 2. knowledge_chunks.source — CHECK constraint out, foreign key in
-- ---------------------------------------------------------------------------

-- Inline CHECKs get the conventional <table>_<column>_check name. Dropped by
-- that name, IF EXISTS so this migration is safe on a database provisioned
-- from a later consolidated schema.
alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_source_check;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_source_fkey
  foreign key (source) references public.knowledge_sources (id)
  on update cascade      -- renaming a source ID follows its chunks
  on delete restrict;    -- a source with ingested content cannot be deleted

-- ---------------------------------------------------------------------------
-- 3. knowledge_chunks.scopes — retrieval scope metadata
--
-- An ARRAY, not a single value, deliberately. A definition such as "what
-- proteinuria means" is legitimately part of both corpora, and the
-- alternative to dual-tagging is storing the passage twice under two source
-- rows — two embeddings of identical text, free to drift apart at the next
-- re-ingestion, for no retrieval benefit.
--
-- The invariant this enforces is therefore "every retrieved passage carries
-- the requested scope", NOT "the two corpora are disjoint sets". That is the
-- property worth testing for leakage in both directions, and it is the one
-- the RPC below guarantees structurally.
-- ---------------------------------------------------------------------------
alter table public.knowledge_chunks
  add column if not exists scopes text[] not null
  default array['general_education']::text[];

-- Backfill is what the DEFAULT above achieves for the existing corpus: every
-- chunk ingested to date belongs to the general CKD education scope. Drop
-- the default afterwards so future ingestion must state scope explicitly
-- rather than silently inheriting it.
alter table public.knowledge_chunks
  alter column scopes drop default;

-- cardinality(), not array_length(): array_length('{}', 1) is NULL, and a
-- CHECK passes on NULL, so an array_length guard would silently admit the
-- empty array — a chunk reachable from neither chatbot. cardinality('{}')
-- is 0 and fails correctly. (The <@ containment test alone is no help here:
-- the empty array is a subset of everything.)
alter table public.knowledge_chunks
  add constraint knowledge_chunks_scopes_valid check (
    cardinality(scopes) >= 1
    and scopes <@ array['general_education', 'screening_clarification']::text[]
  );

comment on column public.knowledge_chunks.scopes is
  'Retrieval scopes this chunk belongs to: general_education (General CKD '
  'Chatbot) and/or screening_clarification (Risk Assessment Chatbot''s LLM '
  'Clarification Engine). Applied as a structural filter inside '
  'match_knowledge_chunks — never as an instruction to the language model.';

create index knowledge_chunks_scopes_idx
  on public.knowledge_chunks using gin (scopes);

-- ---------------------------------------------------------------------------
-- 4. match_knowledge_chunks — scope-filtered cosine similarity search
--
-- The unscoped 3-argument version is dropped, not overloaded. It carries an
-- EXECUTE grant to service_role, so leaving it in place would leave a
-- fully-privileged path that returns chunks from both corpora — exactly the
-- cross-scope leakage the retrieval evaluation is meant to rule out.
-- ---------------------------------------------------------------------------
drop function if exists public.match_knowledge_chunks(
  extensions.vector(768), float, int
);

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_threshold float,
  match_count int,
  match_scope text
)
returns table (
  id uuid,
  source text,
  title text,
  heading_path text,
  content text,
  topic_tags text[],
  scopes text[],
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
    kc.id,
    kc.source,
    kc.title,
    kc.heading_path,
    kc.content,
    kc.topic_tags,
    kc.scopes,
    1 - (kc.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.knowledge_chunks kc
  -- Scope first: an unrecognised match_scope matches nothing and the caller
  -- deflects. Fail-closed is the correct direction here — a typo costs a
  -- deflection, never a leak across corpora.
  where kc.scopes operator(pg_catalog.@>) array[match_scope]::text[]
    and 1 - (kc.embedding operator(extensions.<=>) query_embedding)
      >= match_threshold
  order by kc.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

comment on function public.match_knowledge_chunks is
  'Scope-filtered cosine top-k retrieval shared by both chatbots. '
  'match_scope is mandatory and filtered structurally within the query, so '
  'neither subsystem can widen its own retrieval surface and no prompt-level '
  'instruction can override the separation. Threshold and k are supplied per '
  'scope by the caller (see supabase/functions/_shared/scopes.ts).';

-- Least privilege: Postgres grants EXECUTE to PUBLIC by default on new
-- functions, which would let anon/authenticated PostgREST callers invoke this
-- RPC directly, bypassing the gate/rerank pipeline. RLS already filters their
-- SELECT to zero rows (SECURITY INVOKER + no policies), so that is not a data
-- leak — but the ungated compute surface is unnecessary.
revoke all on function public.match_knowledge_chunks(
  extensions.vector(768), float, int, text
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks(
  extensions.vector(768), float, int, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security on the register
--
-- Same posture as knowledge_chunks: enabled with NO policies, so every
-- browser-facing role is denied by default and only the service role (Edge
-- Functions, ingestion script) reaches it.
-- ---------------------------------------------------------------------------
alter table public.knowledge_sources enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Comment refresh on knowledge_chunks
--
-- The original migration's comments assert General-CKD-Chatbot exclusivity
-- and a CHECK-constrained whitelist. Both are now false. Comments are the
-- only documentation that travels with the schema, so they are corrected
-- here rather than left to contradict the code.
-- ---------------------------------------------------------------------------
comment on table public.knowledge_chunks is
  'Shared RAG-tier grounding chunks. Read by BOTH chatbots through one '
  'scope-filtered pipeline: the General CKD Chatbot retrieves under '
  'general_education, the Risk Assessment Chatbot''s LLM Clarification '
  'Engine under screening_clarification. The Rule-Based Screening Controller '
  'and SCORED Scoring Engine never read this table — the clarification '
  'branch has no write path to any SCORED variable, preserving the '
  'determinism of the validated instrument. Read exclusively server-side '
  'via the service role.';

comment on column public.knowledge_chunks.source is
  'Attributable source ID, foreign key onto public.knowledge_sources. Every '
  'stored chunk must be traceable to a source admitted under the inclusion '
  'framework and approved by the adviser before ingestion.';
