-- BATO — source register delta: admit the Philippine Statistics Authority
--
-- This is the first source admitted through the register rather than through
-- a schema change, which is exactly what 20260806000001 replaced the fixed
-- CHECK constraint to allow: admission is now a data operation with an audit
-- trail (category, publication year, adviser approval date).
--
-- WHY: live testing on 2026-08-06 showed the chatbot could not answer "how
-- many people died from kidney disease?" — the corpus held no Philippine
-- mortality data because no approved source published registered-death
-- counts by cause. PSA is the national statistics authority and the only
-- official publisher of that series.
--
-- Adviser approved 2026-08-06. Mirrored in
-- supabase/functions/_shared/sources.ts (registering without mirroring
-- renders citations with a bare ID).
--
-- CAVEAT carried into every PSA-cited chunk (see knowledge/REVIEW-FLAGS.md
-- §8): PSA reports mortality by ICD cause group — "nephritis, nephrotic
-- syndrome and nephrosis" — which is NOT the same population as chronic
-- kidney disease. It excludes CKD deaths coded to a cardiovascular or
-- diabetic primary cause, so any PSA figure is a floor, not a total. Content
-- citing PSA must state that or BATO overstates the number's precision.
--
-- publication_year is left NULL, matching how DOH and WHO are registered:
-- PSA publishes a new Causes of Death release every year, so pinning one
-- year here would go stale on the next ingestion rather than tracking the
-- release actually cited in the chunk text.

insert into public.knowledge_sources
  (id, name, category, publication_year, adviser_approved_on)
values
  ('PSA', 'Philippine Statistics Authority',
   'official_health_body', null, '2026-08-06')
on conflict (id) do nothing;
