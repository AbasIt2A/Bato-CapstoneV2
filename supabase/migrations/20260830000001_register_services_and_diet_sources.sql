-- BATO — source register delta: Philippine services/cost, and named food and drink
--
-- Admits the four publishers behind SOURCES.md #26-#30, the queued curation
-- pass selected against docs/corpus-blind-spots.md. That audit found the two
-- largest gaps in the corpus were the two questions a Filipino user asks first
-- and the corpus could not answer at all:
--
--   1. "Where do I go, and magkano?" — no facility, no referral pathway, no
--      peso figure existed anywhere in 122 chunks.
--   2. "What can I eat and drink?" — four qualitative chunks that named no
--      food and no drink; zero hits for coffee, soda, alcohol.
--
-- NIDDK (#29) needs no row: it has been registered since 2026-07-08.
--
-- ⚠️ APPROVAL PROVENANCE — READ BEFORE CITING THIS IN THE MANUSCRIPT.
-- adviser_approved_on is set to 2026-08-30 because that is the date these
-- were admitted at the developer's direction, so the ingested chunks have a
-- coherent audit trail. It does NOT record an adviser sign-off meeting. Every
-- one of the four is logged in knowledge/REVIEW-FLAGS.md §13 for confirmation,
-- and DDH in particular is a live admissibility question, not a settled one.

insert into public.knowledge_sources
  (id, name, category, publication_year, adviser_approved_on)
values
  -- Philippine services, cost and coverage ----------------------------------

  ('DAVAOCHO',
   'Davao City Health Office (City Government of Davao)',
   -- An LGU health office is a government health agency, so this is the
   -- straightforward case of the first category. It is also the ONLY source
   -- in the whole register that speaks to BATO's actual study population
   -- rather than to a nation or a planet.
   'official_health_body', 2026, '2026-08-30'),

  ('PHILHEALTH',
   'Philippine Health Insurance Corporation (PhilHealth)',
   -- Government corporation administering the national health insurance
   -- programme; same category as DOH on the same reasoning.
   --
   -- publication_year NULL, matching DOH/WHO/PSA: PhilHealth revises benefit
   -- rates by circular several times a year, so pinning a year here would go
   -- stale on the next ingestion instead of tracking the rate actually cited
   -- in the chunk text. Every PhilHealth figure must be dated IN the text.
   'official_health_body', null, '2026-08-30'),

  ('DDH',
   'Davao Doctors Hospital — Laboratory Department price list',
   -- ⚠️ THE ARGUABLE ADMISSION. A private hospital's own tariff is not a
   -- health authority, not a guideline, and not peer-reviewed literature.
   -- Filed under official_health_body on the narrowest defensible reading:
   -- DDH publishes it as a DOH-licensed clinical laboratory (AO 2021-0037),
   -- and the document is that facility's official published schedule of
   -- charges — the same "licensed publisher" reasoning that admits
   -- AstraZeneca for the SCORED card, not a claim that DDH is a health
   -- authority. Category assignment is per-SOURCE, and no narrower category
   -- exists; the alternative was to leave the corpus with no peso figure at
   -- all, which is what the blind-spot audit ranked as the single most
   -- damaging gap for a Davao-based capstone.
   --
   -- The adviser may reasonably reject this. If so: delete this row, delete
   -- knowledge/official-health-body/ddh/, and the rest of this migration
   -- stands on its own.
   --
   -- publication_year 2025 = the price list's own as-of date (24 March 2025).
   -- Prices go stale faster than any clinical content in the corpus, so every
   -- DDH chunk states that date inline and tells the reader to confirm with
   -- the facility. See REVIEW-FLAGS.md §13.
   'official_health_body', 2025, '2026-08-30'),

  -- Named food and drink ----------------------------------------------------

  ('NKF',
   'National Kidney Foundation (patient education)',
   -- SAME ORGANISATION AS KDOQI, DELIBERATELY A SEPARATE ID. KDOQI is NKF's
   -- clinical-guideline programme and stays registered as clinical_guideline;
   -- this ID covers NKF's consumer patient education, which is a different
   -- kind of document with a different evidentiary weight. Keeping them apart
   -- means a KDOQI recommendation can never be rendered to a user as though
   -- it came from a web article, or the reverse.
   --
   -- Do not merge them, and do not cross-attribute between them — the same
   -- caution the register already carries for PSH vs PSN.
   'official_health_body', 2026, '2026-08-30')

on conflict (id) do nothing;
