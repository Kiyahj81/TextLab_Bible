-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN     "englishWordIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Highlight_userId_verseId_englishWordIndex_idx" ON "Highlight"("userId", "verseId", "englishWordIndex");
