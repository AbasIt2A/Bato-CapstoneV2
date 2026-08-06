-- BATO — Risk Assessment + chat schema, ported from the original capstone
-- project (supabase/migrations/20260703000001_initial_schema.sql) so this
-- standalone build no longer depends on a second Supabase project for the
-- screening/clarify Edge Functions.
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
-- chat_sessions / chat_messages — logs for both chatbots
-- ---------------------------------------------------------------------------
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  assessment_id uuid references public.assessments (id) on delete set null,
  chatbot_type text not null check (
    chatbot_type in ('risk_assessment_clarification', 'general_ckd')
  ),
  started_at timestamptz not null default now(),
  -- assessment_id is non-null only for Clarification Engine sessions. The
  -- General CKD Chatbot is stateless in this build and never opens one.
  constraint assessment_link_matches_chatbot_type check (
    (chatbot_type = 'risk_assessment_clarification' and assessment_id is not null)
    or (chatbot_type = 'general_ckd' and assessment_id is null)
  )
);

comment on table public.chat_sessions is
  'Chat logs. Currently used only by the Risk Assessment Chatbot''s '
  'Clarification Engine (functions/clarify) — the General CKD Chatbot is '
  'single-turn and stateless in this build.';

create index chat_sessions_user_id_idx on public.chat_sessions (user_id);
create index chat_sessions_assessment_id_idx
  on public.chat_sessions (assessment_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null
    references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_session_id_idx
  on public.chat_messages (chat_session_id);

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
-- Model: all writes to screening and chat tables happen server-side in Edge
-- Functions using the service role (which bypasses RLS). Browser clients get
-- read-only access to their own rows, plus direct insert on
-- evaluation_responses (the one flow with no server-side logic).
-- Deny-by-default covers everything not explicitly granted below.
-- ---------------------------------------------------------------------------
alter table public.assessments enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
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

create policy "Users can read their own chat sessions"
  on public.chat_sessions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can read messages of their own chat sessions"
  on public.chat_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_session_id
        and s.user_id = (select auth.uid())
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
