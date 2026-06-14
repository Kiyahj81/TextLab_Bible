-- Make English keyword search match EVERY word, including ones the standard
-- `english` stopword list drops (`just`, `no`, `own`, `all`, `before`, ...).
-- The /search keyword box is WYSIWYG: a user who types a word wants verses that
-- contain it. Stopword filtering for the natural-language Assistant lives in the
-- app layer (lib/ai/signals.ts STOP_WORDS -> detectTopicWords), NOT in this shared
-- FTS config, so dropping stopwords here was redundant for the Assistant and broke
-- the search box as a side effect.
--
-- Swap the built-in `english_stem` dictionary (Snowball + StopWords = english) for
-- a custom Snowball dictionary with NO stopword list. Stemming is unchanged
-- (loved -> love); only stopword dropping is removed.

-- 1. Snowball stemmer without a stopword list. The snowball template is IMMUTABLE,
--    so to_tsvector('bible_english', text) stays IMMUTABLE (required by the
--    STORED generated column).
CREATE TEXT SEARCH DICTIONARY english_stem_nostop (
  TEMPLATE = snowball,
  Language = english
);

-- 2. Re-point bible_english's word-token mapping at the no-stopword stemmer.
--    Same token list and unaccent prefix as 20260613120000_english_stem_fts.
ALTER TEXT SEARCH CONFIGURATION bible_english
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, english_stem_nostop;

-- 3. Rebuild Verse.textSearchEn. Changing the config does NOT recompute a STORED
--    generated column, so drop and re-add it: the re-add recomputes every row with
--    the new mapping. The whole file runs in one transaction (all-DDL), so readers
--    never see a missing column. ~16k rows; sub-second ACCESS EXCLUSIVE lock.
DROP INDEX IF EXISTS "Verse_textSearchEn_idx";
ALTER TABLE "Verse" DROP COLUMN "textSearchEn";
ALTER TABLE "Verse"
  ADD COLUMN "textSearchEn" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_english', "text")) STORED;
CREATE INDEX "Verse_textSearchEn_idx" ON "Verse" USING GIN ("textSearchEn");
