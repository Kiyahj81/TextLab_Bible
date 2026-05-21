-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."AiMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AiSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Book" (
    "id" TEXT NOT NULL,
    "osisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Corpus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "license" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Corpus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GeneratedStudyNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedStudyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Highlight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verseId" TEXT,
    "tokenId" TEXT,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "corpus" TEXT,
    "status" TEXT NOT NULL,
    "booksImported" INTEGER NOT NULL DEFAULT 0,
    "versesImported" INTEGER NOT NULL DEFAULT 0,
    "tokensImported" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verseId" TEXT,
    "tokenId" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "corpus" TEXT,
    "book" TEXT,
    "chapter" INTEGER,
    "matchMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Token" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "wordIndex" INTEGER NOT NULL,
    "surface" TEXT NOT NULL,
    "normalized" TEXT,
    "lemma" TEXT,
    "morphCode" TEXT,
    "partOfSpeech" TEXT,
    "gloss" TEXT,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Verse" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "Verse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Book_osisId_key" ON "public"."Book"("osisId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Corpus_abbreviation_key" ON "public"."Corpus"("abbreviation" ASC);

-- CreateIndex
CREATE INDEX "GeneratedStudyNote_userId_createdAt_idx" ON "public"."GeneratedStudyNote"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ImportRun_source_status_idx" ON "public"."ImportRun"("source" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "ImportRun_startedAt_idx" ON "public"."ImportRun"("startedAt" ASC);

-- CreateIndex
CREATE INDEX "SavedSearch_userId_updatedAt_idx" ON "public"."SavedSearch"("userId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "Token_bookId_chapter_verse_idx" ON "public"."Token"("bookId" ASC, "chapter" ASC, "verse" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Token_corpusId_bookId_chapter_verse_wordIndex_key" ON "public"."Token"("corpusId" ASC, "bookId" ASC, "chapter" ASC, "verse" ASC, "wordIndex" ASC);

-- CreateIndex
CREATE INDEX "Token_lemma_idx" ON "public"."Token"("lemma" ASC);

-- CreateIndex
CREATE INDEX "Token_morphCode_idx" ON "public"."Token"("morphCode" ASC);

-- CreateIndex
CREATE INDEX "Verse_bookId_chapter_verse_idx" ON "public"."Verse"("bookId" ASC, "chapter" ASC, "verse" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Verse_corpusId_bookId_chapter_verse_key" ON "public"."Verse"("corpusId" ASC, "bookId" ASC, "chapter" ASC, "verse" ASC);

-- AddForeignKey
ALTER TABLE "public"."AiMessage" ADD CONSTRAINT "AiMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."AiSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Highlight" ADD CONSTRAINT "Highlight_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Highlight" ADD CONSTRAINT "Highlight_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "public"."Verse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Note" ADD CONSTRAINT "Note_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Note" ADD CONSTRAINT "Note_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "public"."Verse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Token" ADD CONSTRAINT "Token_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Token" ADD CONSTRAINT "Token_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "public"."Corpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Verse" ADD CONSTRAINT "Verse_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Verse" ADD CONSTRAINT "Verse_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "public"."Corpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

