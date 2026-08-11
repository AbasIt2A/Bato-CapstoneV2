-- BATO — source register delta: admit the nine publishers behind the Top 20
-- knowledge-base source list (SOURCES.md).
--
-- Eleven of the twenty entries in SOURCES.md already traced to a registered
-- source (KDIGO, NIDDK, CDC, WHO, SCORED). Nine remained; seven of those are
-- registered below, the other two having been dropped the next day — see the
-- AMENDED note. All were approved by the adviser on 2026-08-10 and mirrored in
-- supabase/functions/_shared/sources.ts — registering without mirroring
-- renders citations with a bare ID, mirroring without registering makes
-- ingestion fail on the foreign key.
--
-- Registration is NOT ingestion. No chunk from any of these sources exists in
-- the corpus yet; scripts/scrape-sources.ts can now fetch them and
-- scripts/clean-scraped.ts will attribute them correctly, but the content
-- still passes through curation, REVIEW-FLAGS logging and `approved: true`
-- before scripts/ingest-knowledge.ts will embed a word of it.
--
-- ===== CATEGORY ASSIGNMENTS =====
--
-- The framework admits three categories and nothing else, so each source is
-- placed by what the PUBLISHER is, not by how the document reads:
--
--   peer_reviewed      — indexed, editorially peer-reviewed literature.
--                        PHESRD, CHEN2019.
--   clinical_guideline — per the category comment in 20260806000001, this
--                        covers "KDIGO and peer nephrology/allied bodies".
--                        NICE, KDOQI, ISN, APSN, PSH.
--
-- TWO PLACEMENTS ARE GENUINELY ARGUABLE and are flagged here rather than
-- buried, because the manuscript has to defend them:
--
--   ISN  — the Global Kidney Health Atlas is a capacity SURVEY, not a
--          guideline. It is filed under clinical_guideline because ISN is a
--          peer nephrology body and the other two categories fit worse (it is
--          neither an official/governmental health body nor a peer-reviewed
--          journal article). If the adviser prefers, the honest alternative
--          is to widen the category vocabulary rather than restate what the
--          Atlas is.
--
--   APSN — published in Nephrology (Wiley), a peer-reviewed journal, which
--          argues for peer_reviewed. Filed as clinical_guideline because the
--          document IS a society guideline update; the journal is its venue,
--          not its nature. Same reasoning KDIGO gets.
--
-- ===== NAMING CAUTION =====
--
-- PSH (Philippine Society of Hypertension) is NOT PSN (Philippine Society of
-- Nephrology), which has been registered since 2026-07-08. Two Philippine
-- specialty societies, two different sets of guidelines, adjacent acronyms.
-- Attributing a blood-pressure figure to PSN because the IDs look alike is a
-- provenance error the citation layer cannot catch.
--
-- publication_year carries the edition/publication actually cited. NICE NG203
-- is pinned to its 2021 publication; if a later NG203 revision is curated in,
-- update the row rather than letting the year drift from the text.

-- ===== AMENDED 2026-08-11 =====
--
-- Two of the nine were dropped a day after registration: PHCOI (Philippine
-- cost-of-illness, Journal of Medical Economics) and GBD (Lancet 2023 burden).
-- Neither can be retrieved — Taylor & Francis paywalls the first, and the
-- Lancet page returns an advertising shell whose article never renders — so
-- neither will ever have a chunk to attribute, and a register entry with no
-- reachable source is a claim the corpus cannot honour.
--
-- Their INSERT rows are removed here rather than left with a compensating
-- DELETE, because this migration is the fresh-deploy definition of the
-- register: a new environment should arrive at today's seven, not add two
-- rows and then take them away again. The live database already matches.
--
-- To reinstate either, obtain the text first, then add its row back here, to
-- _shared/sources.ts, and clear `excluded` in scripts/scrape/manifest.ts.

insert into public.knowledge_sources
  (id, name, category, publication_year, adviser_approved_on)
values
  -- Philippine burden and care-pathway evidence -----------------------------
  ('PHESRD',
   'Gaps and Challenges in the Treatment of End-Stage Renal Disease in the '
   'Philippines (PMC10544423, 2023)',
   'peer_reviewed', 2023, '2026-08-10'),

  ('PSH', 'Philippine Society of Hypertension',
   'clinical_guideline', 2020, '2026-08-10'),

  -- Global burden and synthesis ---------------------------------------------
  ('CHEN2019',
   'Chen, Knicely & Grams, 2019 (Chronic Kidney Disease Diagnosis and '
   'Management, JAMA)',
   'peer_reviewed', 2019, '2026-08-10'),

  -- Guideline and allied nephrology bodies ----------------------------------
  ('NICE',
   'National Institute for Health and Care Excellence (UK)',
   'clinical_guideline', 2021, '2026-08-10'),

  ('KDOQI',
   'Kidney Disease Outcomes Quality Initiative (National Kidney Foundation)',
   'clinical_guideline', 2020, '2026-08-10'),

  ('ISN',
   'International Society of Nephrology (Global Kidney Health Atlas)',
   'clinical_guideline', 2023, '2026-08-10'),

  ('APSN',
   'Asian Pacific Society of Nephrology',
   'clinical_guideline', 2025, '2026-08-10')

on conflict (id) do nothing;
