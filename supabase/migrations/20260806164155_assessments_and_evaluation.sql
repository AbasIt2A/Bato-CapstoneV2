-- BATO — Risk Assessment + evaluation schema, ported from the original
-- capstone project (supabase/migrations/20260703000001_initial_schema.sql) so
-- this standalone build no longer depends on a second Supabase project for
-- the screening/clarify Edge Functions.
--
-- Originally named "assessments_and_chat". The chat_sessions / chat_messages
-- tables it carried were removed on 2026-08-10 — unused by every source file
-- and absent from the deployed database. See the note where they used to be.
--
-- Identity: Supabase Auth (auth.users) is the source of truth. Anonymous
-- sign-ins are enabled, so every visitor — including account-less ones —
-- has an auth.users row and a stable auth.uid() for RLS.

-- ---------------------------------------------------------------------------
-- assessments — one row per screening session
-- ---------------------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_score int check (total_score between 0 and 12),
  classification text
    check (classification in ('Screen Negative', 'Screen Positive')),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  -- A completed assessment must carry its final score and classification.
  constraint completed_assessments_are_scored check (
    status <> 'completed'
    or (
      total_score is not null
      and classification is not null
      and completed_at is not null
    )
  )
);

comment on table public.assessments is
  'One SCORED screening session. Classification is binary only: '
  'Screen Negative (0-3) / Screen Positive (>=4). Written exclusively by the '
  'Rule-Based Screening Controller Edge Function via service role.';

create index assessments_user_id_idx on public.assessments (user_id);

-- ---------------------------------------------------------------------------
-- assessment_responses — one row per answered SCORED variable
-- ---------------------------------------------------------------------------
create table public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.assessments (id) on delete cascade,
  variable_key text not null check (
    variable_key in (
      'age', 'female', 'anemia', 'hypertension', 'diabetes',
      'cvd_history', 'chf_history', 'pvd', 'proteinuria'
    )
  ),
  value_raw text not null,
  -- Age contributes 0-4 points; every other variable 0-1.
  points_awarded int not null check (
    (variable_key = 'age' and points_awarded between 0 and 4)
    or (variable_key <> 'age' and points_awarded between 0 and 1)
  ),
  created_at timestamptz not null default now(),
  -- The controller asks each variable exactly once per assessment.
  unique (assessment_id, variable_key)
);

comment on table public.assessment_responses is
  'Individual SCORED variable answers. points_awarded is computed by the '
  'deterministic scoring module (_shared/scored.ts) — never by an LLM.';

create index assessment_responses_assessment_id_idx
  on public.assessment_responses (assessment_id);

-- ---------------------------------------------------------------------------
-- REMOVED 2026-08-10 — chat_sessions / chat_messages
--
-- These two tables were ported over with the rest of the schema and never
-- used. Three independent facts agree on that:
--
--   * no source file in the repository references either table — not the
--     clarify Edge Function this comment originally claimed owned them, not
--     general-chat, not the frontend;
--   * neither exists in the deployed database. The 20260808000000 baseline
--     did not carry them, so the schema this file described had already
--     diverged from the schema that actually runs;
--   * nothing was lost by their absence, because nothing ever wrote to them.
--
-- Dropping the DDL here brings this file back into agreement with the
-- deployed database rather than leaving a fresh `supabase db push` to create
-- two empty tables plus their RLS policies for no reason. If conversation
-- logging is wanted later, it should be designed against the retention and
-- consent requirements in the manuscript (RA 10173), not resurrected from a
-- port that predates them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- evaluation_responses — SUS / TAM / TiMT capture
-- ---------------------------------------------------------------------------
create table public.evaluation_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  instrument text not null check (instrument in ('SUS', 'TAM', 'TiMT')),
  responses jsonb not null,
  score numeric,
  submitted_at timestamptz not null default now()
);

create index evaluation_responses_user_id_idx
  on public.evaluation_responses (user_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security (RA 10173)
--
-- Model: all writes to the screening tables happen server-side in Edge
-- Functions using the service role (which bypasses RLS). Browser clients get
-- read-only access to their own rows, plus direct insert on
-- evaluation_responses (the one flow with no server-side logic).
-- Deny-by-default covers everything not explicitly granted below.
-- ---------------------------------------------------------------------------
alter table public.assessments enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.evaluation_responses enable row level security;

create policy "Users can read their own assessments"
  on public.assessments for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can read responses of their own assessments"
  on public.assessment_responses for select
  to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_id
        and a.user_id = (select auth.uid())
    )
  );

create policy "Users can read their own evaluation responses"
  on public.evaluation_responses for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can submit their own evaluation responses"
  on public.evaluation_responses for insert
  to authenticated
  with check (user_id = (select auth.uid()));
