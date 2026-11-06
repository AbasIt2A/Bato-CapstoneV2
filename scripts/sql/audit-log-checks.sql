-- Database checks for the chat safety audit log (UIC-REC protocol
-- UG-ER-09-26-0744). Paste into the Supabase SQL editor and run.
--
-- Everything runs inside one transaction that is rolled back at the end, so
-- no rows are left behind and no real rows are deleted. Test codes P9998 and
-- P9999 are used so the checks never depend on real participants' rows.
-- Each check raises an exception on failure; success prints NOTICE lines.

begin;

-- Test rows: two for P9999, one for P9998, one from an uncoded session.
insert into public.chat_audit_log (scope, question, reply, outcome, participant_code)
values
  ('general_education', 'check q1', 'r', 'answered', 'P9999'),
  ('screening_clarification', 'check q2', 'r', 'answered', 'P9999'),
  ('general_education', 'check q3', 'r', 'answered', 'P9998'),
  ('general_education', 'check q4', 'r', 'answered', null);

-- 1. The column accepts only P plus 1-4 digits.
do $$
declare
  bad text;
begin
  foreach bad in array array['abc', 'P', 'P12345', 'p07', 'P07; drop table x', 'Juan dela Cruz']
  loop
    begin
      insert into public.chat_audit_log (scope, question, reply, outcome, participant_code)
      values ('general_education', 'check bad', 'r', 'answered', bad);
      raise exception 'FAIL: participant_code accepted %', quote_literal(bad);
    exception when check_violation then
      null; -- expected
    end;
  end loop;
  raise notice 'PASS 1: participant_code rejects free text';
end $$;

-- 2. Withdrawal deletes exactly that participant's rows.
do $$
declare
  removed bigint;
begin
  removed := public.delete_participant_audit_rows('P9999');
  if removed <> 2 then
    raise exception 'FAIL: expected 2 rows deleted for P9999, got %', removed;
  end if;
  if exists (select 1 from public.chat_audit_log where participant_code = 'P9999') then
    raise exception 'FAIL: P9999 rows remain';
  end if;
  if not exists (select 1 from public.chat_audit_log where question = 'check q3') then
    raise exception 'FAIL: P9998 row was deleted';
  end if;
  if not exists (select 1 from public.chat_audit_log where question = 'check q4') then
    raise exception 'FAIL: uncoded row was deleted';
  end if;
  raise notice 'PASS 2: withdrawal removed only P9999 (% rows)', removed;
end $$;

-- 3. Withdrawal refuses anything that is not a participant code.
do $$
begin
  begin
    perform public.delete_participant_audit_rows('abc');
    raise exception 'FAIL: delete_participant_audit_rows accepted abc';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'PASS 3: withdrawal rejects an invalid code';
end $$;

-- 4. Browsers (anon / authenticated) cannot call either function.
do $$
begin
  if has_function_privilege('anon', 'public.delete_participant_audit_rows(text)', 'execute')
     or has_function_privilege('authenticated', 'public.delete_participant_audit_rows(text)', 'execute')
     or has_function_privilege('anon', 'public.purge_study_records(date)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_study_records(date)', 'execute') then
    raise exception 'FAIL: a browser role can execute a deletion function';
  end if;
  raise notice 'PASS 4: deletion functions are not callable from the browser';
end $$;

-- 5. End-of-retention purge refuses to run early, and deletes everything
--    (coded and uncoded) once the period has passed.
do $$
declare
  audit_rows bigint;
begin
  begin
    perform public.purge_study_records(current_date);
    raise exception 'FAIL: purge ran before the retention period ended';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  select p.audit_log_rows into audit_rows
  from public.purge_study_records((current_date - interval '3 years 1 day')::date) p;
  if exists (select 1 from public.chat_audit_log) then
    raise exception 'FAIL: rows remain after purge';
  end if;
  raise notice 'PASS 5: purge refuses early, then removed all % rows', audit_rows;
end $$;

rollback;
