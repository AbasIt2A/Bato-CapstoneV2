-- BATO — disposal of retained study records (UIC-REC protocol
-- UG-ER-09-26-0744).
--
-- The ICF states that research records are "kept for 3 years after the study
-- ends. After that, ... electronic files are permanently deleted." The two
-- tables BATO keeps for the study are:
--
--   * chat_audit_log       — chatbot questions and replies (safety audit)
--   * evaluation_responses — SUS / TAM / TiMT survey answers
--
-- Screening data (assessments, assessment_responses) is not covered here: it
-- is deleted at the end of each session (see 20261028083112).
--
-- The study end date is not known when this migration runs, so disposal is
-- NOT scheduled. On or after the end of the retention period the research
-- team runs, from the Supabase SQL editor:
--
--   select * from public.purge_study_records('YYYY-MM-DD');  -- study end date
--
-- The function refuses to run before study_end + 3 years, so a wrong or early
-- date cannot destroy records the ICF promises to keep. Deleting these rows
-- does not remove copies outside the database (CSV exports, downloaded
-- backups); those must be deleted by hand at the same time.
-- ---------------------------------------------------------------------------
create or replace function public.purge_study_records(study_end date)
returns table (audit_log_rows bigint, evaluation_rows bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  disposal_date date := study_end + interval '3 years';
begin
  if study_end is null then
    raise exception 'purge_study_records: study_end is required';
  end if;
  if current_date < disposal_date then
    raise exception
      'purge_study_records: retention period runs until %; refusing to delete',
      disposal_date;
  end if;

  delete from public.chat_audit_log;
  get diagnostics audit_log_rows = row_count;

  delete from public.evaluation_responses;
  get diagnostics evaluation_rows = row_count;

  return next;
end;
$$;

comment on function public.purge_study_records(date) is
  'Permanently deletes retained study records (chat_audit_log, '
  'evaluation_responses) once 3 years have passed since study_end. '
  'Run manually; not scheduled. See ICF.';

revoke all on function public.purge_study_records(date) from public, anon, authenticated;
