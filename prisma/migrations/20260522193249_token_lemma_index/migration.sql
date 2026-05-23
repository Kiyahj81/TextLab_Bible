-- CreateIndex
CREATE INDEX "Token_corpusId_bookId_partOfSpeech_lemma_idx" ON "Token"("corpusId", "bookId", "partOfSpeech", "lemma");
