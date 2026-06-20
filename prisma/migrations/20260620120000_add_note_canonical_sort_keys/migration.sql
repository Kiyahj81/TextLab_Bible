-- AlterTable
ALTER TABLE "Note" ADD COLUMN "refBookOrder" INTEGER;
ALTER TABLE "Note" ADD COLUMN "refChapter" INTEGER;
ALTER TABLE "Note" ADD COLUMN "refVerse" INTEGER;

-- Backfill the denormalized canonical sort keys from each note's attached verse
-- or token. Verse takes precedence when both somehow exist, matching the
-- application's noteCanonicalKey() helper.
UPDATE "Note" n
SET "refBookOrder" = src."bookOrder",
    "refChapter"   = src."chapter",
    "refVerse"     = src."verse"
FROM (
  SELECT n2."id",
         COALESCE(vb."order", tb."order")     AS "bookOrder",
         COALESCE(v."chapter", t."chapter")   AS "chapter",
         COALESCE(v."verse", t."verse")       AS "verse"
  FROM "Note" n2
  LEFT JOIN "Verse" v  ON n2."verseId" = v."id"
  LEFT JOIN "Book"  vb ON v."bookId"   = vb."id"
  LEFT JOIN "Token" t  ON n2."tokenId" = t."id"
  LEFT JOIN "Book"  tb ON t."bookId"   = tb."id"
) src
WHERE n."id" = src."id";

-- CreateIndex
CREATE INDEX "Note_userId_refBookOrder_refChapter_refVerse_idx" ON "Note"("userId", "refBookOrder", "refChapter", "refVerse");
