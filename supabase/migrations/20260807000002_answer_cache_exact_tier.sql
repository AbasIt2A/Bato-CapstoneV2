-- BATO — answer cache, delta: exact-match tier
--
-- DRAFT migration. DO NOT APPLY without explicit checkpoint approval.
--
-- ===== WHY =====
--
-- The cache shipped in 20260807000001 matched on embedding similarity alone.
-- Measurement on 2026-08-07 showed that cannot be done safely on this corpus:
-- same-meaning and different-meaning question pairs occupy an OVERLAPPING
-- similarity band, under both embedding geometries available.
--
--                            RETRIEVAL_QUERY   SEMANTIC_SIMILARITY
--   same meaning, lowest         0.729               0.885
--   different meaning, highest   0.863               0.925
--
-- Under SEMANTIC_SIMILARITY, "How do I prevent CKD?" and "How do I TREAT
-- CKD?" score 0.925, above the genuine paraphrase "Can you explain chronic
-- kidney disease?" / "what does CKD mean" at 0.885. There is no threshold
-- inside that band which admits the paraphrase and rejects the pair that
-- would serve a treatment answer to a prevention question — and nothing
-- downstream can catch that error, because a cached reply is served verbatim
-- having passed its guards for a DIFFERENT question.
--
-- The failure is structural, not a tuning problem: these embeddings encode
-- topic, while prevent/treat, curable/preventable and avoid/prefer are single
-- operators that barely move the vector yet fully change the correct answer.
--
-- So the similarity threshold moves ABOVE the whole measured false-hit range
-- (0.97 / 0.98, in scopes.ts) and becomes a rare backstop, while this
-- migration adds the tier that actually pays: exact match on a normalised
-- question string. It cannot produce a false hit by construction, costs no
-- embedding call, and catches the dominant repeat pattern of an evaluation
-- study, where participants work from a shared task script.

-- ---------------------------------------------------------------------------
-- 0. Purge rows embedded in the OLD geometry
--
-- Entries written before this change hold RETRIEVAL_QUERY vectors, while the
-- similarity tier now queries with SEMANTIC_SIMILARITY vectors. Cosine
-- distance between two different embedding spaces is not a weak signal — it
-- is not a signal at all, and leaving both in one table would silently mix
-- comparable and incomparable rows with no way to tell them apart at query
-- time.
--
-- Deleting is correct rather than merely convenient: these rows cannot be
-- converted without re-embedding, they are worth nothing (a cache is a
-- derived artefact — anything dropped is simply regenerated on next ask),
-- and at the time of writing they number in the single digits, all from
-- today's verification runs.
--
-- If this migration is ever re-run against a populated cache, the same
-- reasoning still holds: correctness of the geometry outranks the hit rate.
-- ---------------------------------------------------------------------------
delete from public.answer_cache;

-- ---------------------------------------------------------------------------
-- 1. question_norm — canonical form of the question, for exact matching
--
-- Populated by the application (answer-cache.ts normalizeQuestion), NOT by a
-- generated column or trigger. The canonical form is owned by the same code
-- that queries it, so the two cannot drift into disagreeing about what "the
-- same question" means — a drift that would silently either stop matching or,
-- worse, start matching the wrong thing.
--
-- Normalisation folds away ONLY what cannot change meaning: case, repeated
-- and surrounding whitespace, and trailing terminal punctuation. Deliberately
-- no stemming and no stop-word removal; both can merge questions that differ
-- in meaning, which is the one thing this tier exists to make impossible.
-- ---------------------------------------------------------------------------
alter table public.answer_cache
  add column if not exists question_norm text;

-- Backfill. A no-op on a fresh run, since step 0 just emptied the table —
-- kept because it makes the NOT NULL below safe regardless of what state the
-- table is in, and because SQL is the wrong place to assume the step above
-- ran. The expression mirrors normalizeQuestion for these simple cases; any
-- row it gets subtly wrong costs at most a missed cache hit, never a wrong
-- answer, because the exact tier only ever matches equal strings.
update public.answer_cache
set question_norm = regexp_replace(
      regexp_replace(lower(question), '\s+', ' ', 'g'),
      '[\s?!.]+$', '', 'g'
    )
where question_norm is null;

alter table public.answer_cache
  alter column question_norm set not null;

comment on column public.answer_cache.question_norm is
  'Canonical form of question (lowercased, whitespace collapsed, trailing '
  'terminal punctuation removed), written by the application''s '
  'normalizeQuestion(). Backs the exact-match cache tier, which cannot '
  'produce a false hit — unlike similarity matching, which measurement '
  'showed cannot separate paraphrases from near-misses on this corpus.';

-- Covers the exact-tier lookup, which filters on both columns. Not UNIQUE:
-- two rows for the same normalised question are harmless (the lookup takes
-- one), whereas a unique constraint would turn a benign race between two
-- concurrent identical questions into a failed insert.
create index if not exists answer_cache_scope_question_norm_idx
  on public.answer_cache (scope, question_norm);
