-- Vector embeddings for semantic retrieval (Phase 4a).
-- Only WEB verses are embedded; the semantic index corpus. Citations still
-- resolve to the SBLGNT spine via the shared (book, chapter, verse).

-- 1. pgvector extension (available on Neon).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. One embedding per verse (1:1 with Verse), cascade on verse delete.
CREATE TABLE "VerseEmbedding" (
  "verseId"   TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "model"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerseEmbedding_pkey" PRIMARY KEY ("verseId")
);

ALTER TABLE "VerseEmbedding"
  ADD CONSTRAINT "VerseEmbedding_verseId_fkey"
  FOREIGN KEY ("verseId") REFERENCES "Verse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. HNSW index for fast cosine KNN (1536 dims is within pgvector's index limit).
CREATE INDEX "VerseEmbedding_embedding_idx"
  ON "VerseEmbedding" USING hnsw ("embedding" vector_cosine_ops);
