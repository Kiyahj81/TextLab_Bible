-- English Snowball stemming for keyword search (WEB only).
-- Mirrors the bible_simple recipe (20260530120000_lexical_fts) but ends the
-- mapping in english_stem so English inflections share a stem. Greek keeps
-- bible_simple via the existing textSearch column.

-- 1. Immutable English config: clone `english` (keeps its token mappings and the
--    Snowball stopword handling), then route word-bearing tokens through
--    unaccent -> english_stem. Wiring unaccent in as a dictionary is what keeps
--    to_tsvector('bible_english', text) IMMUTABLE (required by a generated column).
DROP TEXT SEARCH CONFIGURATION IF EXISTS bible_english;
CREATE TEXT SEARCH CONFIGURATION bible_english (COPY = english);
ALTER TEXT SEARCH CONFIGURATION bible_english
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, english_stem;

-- 2. Second generated tsvector column (STORED backfills all rows on creation).
ALTER TABLE "Verse"
  ADD COLUMN "textSearchEn" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_english', "text")) STORED;

-- 3. GIN index for fast @@ matching on the English column.
CREATE INDEX "Verse_textSearchEn_idx" ON "Verse" USING GIN ("textSearchEn");
