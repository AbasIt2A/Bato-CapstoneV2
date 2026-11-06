-- BATO — UIC-REC revisions (protocol UG-ER-09-26-0744, decision letter of
-- 2026-10-23): screening-data retention and the chatbot safety audit log.

-- ---------------------------------------------------------------------------
-- 1. Screening data is not kept after the session
--
-- The ICF tells participants BATO "does not retain your screening responses
-- or results after your session ends". The screening Edge Function now
-- deletes an assessment (and, by cascade, its answers) as soon as the result
-- is returned or the user abandons. This job removes what a closed browser
-- tab leaves behind: any assessment older than three hours — far past the
-- 15-20 minute study session, so it never touches someone still answering.
-- ---------------------------------------------------------------------------
create or replace function public.purge_stale_assessments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.assessments
  where started_at < now() - interval '3 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_stale_assessments() is
  'Deletes assessments older than 3 hours (abandoned sessions). Completed '
  'ones are already deleted by the screening Edge Function. See ICF.';

revoke all on function public.purge_stale_assessments() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-stale-assessments',
  '*/30 * * * *',
  $$select public.purge_stale_assessments()$$
);

-- ---------------------------------------------------------------------------
-- 2. Chatbot safety audit log
--
-- The REC recommends "a continuous safety audit log during Sprint 6 to
-- verify that no inaccurate clinical explanations are served to human
-- participants". One row per chatbot reply, written by both Edge Functions
-- (_shared/audit-log.ts). No user id or session id is stored: rows cannot be
-- linked to a participant.
--
-- Access: RLS on and NO policies, so browsers can neither read nor write it.
-- Only the service role (Edge Functions) and the research team, through the
-- Supabase dashboard, can see it. It is study data, kept and disposed of on
-- the schedule stated in the ICF and manuscript.
-- ---------------------------------------------------------------------------
create table public.chat_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope text not null
    check (scope in ('general_education', 'screening_clarification')),
  question text not null,
  reply text not null,
  sources jsonb not null default '[]'::jsonb,
  outcome text not null
    check (outcome in ('answered', 'deflected', 'service_error')),
  -- Filled in by the research team during review.
  reviewed_at timestamptz,
  review_verdict text
    check (review_verdict in ('accurate', 'inaccurate', 'unclear')),
  review_note text
);

comment on table public.chat_audit_log is
  'Safety audit log (UIC-REC): every chatbot reply served, for accuracy '
  'review by the research team. No participant identifiers. Service role only.';

create index chat_audit_log_created_at_idx on public.chat_audit_log (created_at);

alter table public.chat_audit_log enable row level security;
