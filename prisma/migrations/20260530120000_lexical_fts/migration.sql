-- Lexical full-text search for Verse.text (Phase 3).
-- Order matters: the unaccent extension and the bible_simple config must exist
-- before the generated column references the config.

-- 1. unaccent extension (available on Neon).
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Custom immutable text-search config: clone `simple`, then route word-bearing
--    token types through unaccent -> simple. Wiring unaccent in as a dictionary is
--    what makes to_tsvector('bible_simple', text) IMMUTABLE (required by the
--    generated column). A bare unaccent() call is NOT immutable.
DROP TEXT SEARCH CONFIGURATION IF EXISTS bible_simple;
CREATE TEXT SEARCH CONFIGURATION bible_simple (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION bible_simple
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, simple;

-- 3. Generated tsvector column (STORED backfills existing rows on creation).
ALTER TABLE "Verse"
  ADD COLUMN "textSearch" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_simple', "text")) STORED;

-- 4. GIN index for fast @@ matching.
CREATE INDEX "Verse_textSearch_idx" ON "Verse" USING GIN ("textSearch");
