-- BATO — participant codes on the chat safety audit log, and withdrawal
-- deletion (UIC-REC protocol UG-ER-09-26-0744).
--
-- During the Sprint 6 evaluation the researcher opens BATO for each
-- participant with ?pid=P07. The browser keeps that code for the tab and
-- sends it with every chat request; the audit-log wrapper (_shared/audit-
-- log.ts) validates it and stores it on each row. Rows written outside a
-- coded session carry null.
--
-- The code exists for one purpose: if a participant withdraws, the research
-- team can delete exactly their rows. It is never shown to or asked of the
-- participant, and the CHECK constraint below admits only "P" plus 1–4
-- digits, so no free text can be stored in the column.
--
-- The question column already holds filtered text: phone numbers, emails,
-- ID numbers and detectable names and addresses are replaced before the
-- insert (_shared/personal-details.ts).
--
-- End of retention is unchanged: purge_study_records (20261029090000)
-- deletes every chat_audit_log row, coded or not.
-- ---------------------------------------------------------------------------
alter table public.chat_audit_log
  add column participant_code text
    check (participant_code ~ '^P[0-9]{1,4}$');

create index chat_audit_log_participant_code_idx
  on public.chat_audit_log (participant_code)
  where participant_code is not null;

comment on column public.chat_audit_log.participant_code is
  'Researcher-set evaluation code (P + 1-4 digits), null outside coded '
  'sessions. Used only to delete a withdrawing participant''s rows.';

comment on table public.chat_audit_log is
  'Safety audit log (UIC-REC): every chatbot reply served, for accuracy '
  'review by the research team. Questions are filtered for personal details '
  'before insert. No user or session id; optional participant code for '
  'withdrawal. Service role only.';

-- ---------------------------------------------------------------------------
-- Withdrawal: delete one participant's rows
--
-- Run by the research team from the Supabase SQL editor, or by server code
-- with the service role:
--
--   select public.delete_participant_audit_rows('P07');
--
-- Returns the number of rows deleted; record it with the withdrawal. Rows a
-- participant produced before the researcher set their code (or in an
-- uncoded tab) carry no code and cannot be found this way.
-- ---------------------------------------------------------------------------
create or replace function public.delete_participant_audit_rows(code text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed bigint;
begin
  if code is null or code !~ '^P[0-9]{1,4}$' then
    raise exception
      'delete_participant_audit_rows: % is not a participant code (P + 1-4 digits)',
      coalesce(quote_literal(code), 'null');
  end if;

  delete from public.chat_audit_log where participant_code = code;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.delete_participant_audit_rows(text) is
  'Deletes every chat_audit_log row for one participant code (withdrawal). '
  'Service role only.';

revoke all on function public.delete_participant_audit_rows(text) from public, anon, authenticated;
grant execute on function public.delete_participant_audit_rows(text) to service_role;
