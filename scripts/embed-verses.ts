// Idempotent embedding ingestion: embeds WEB verses with text-embedding-3-small and
// upserts VerseEmbedding rows (skips empty verses; retries transient 5xx).
//
// Run via `npm run embed:verses` (which passes `tsx --env-file=.env`). A bare
// `tsx scripts/embed-verses.ts` does NOT auto-load .env, so always go through the npm
// script or pass `--env-file` yourself; the script reads OPENAI_API_KEY and
// DATABASE_URL from the environment. To target a different DB (e.g. a Neon test
// branch), run `tsx --env-file=.env.test scripts/embed-verses.ts`.
import { PrismaClient, Prisma } from "@prisma/client";
import OpenAI from "openai";
import {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "../lib/search/semanticIndex";

const prisma = new PrismaClient();
const BATCH = 100;

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required to embed verses.");
    process.exit(1);
  }
  // Bulk job over thousands of verses: raise maxRetries so the SDK's exponential
  // backoff rides out transient 429/5xx bursts instead of aborting the whole run.
  const client = new OpenAI({ apiKey, maxRetries: 6 });

  // Idempotent/resumable: re-embed when the row is missing, the embedding model
  // changed, or the indexed WEB text changed since the embedding was written.
  const candidates = await prisma.$queryRaw<{ id: string; text: string; model: string | null; textHash: string | null }[]>(Prisma.sql`
    SELECT v."id" AS id, v."text" AS text, e."model" AS model, e."textHash" AS "textHash"
    FROM "Verse" v
    JOIN "Corpus" c ON c."id" = v."corpusId"
    LEFT JOIN "VerseEmbedding" e ON e."verseId" = v."id"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS}
    ORDER BY v."id"
  `);
  const pending = candidates.filter(
    (v) => v.model !== EMBEDDING_MODEL || v.textHash !== embeddingTextHash(v.text)
  );

  const embeddable = pending.filter((v) => v.text.trim().length > 0);
  const skipped = pending.length - embeddable.length;
  if (skipped > 0) console.log(`Skipping ${skipped} empty/whitespace-only verse(s).`);

  console.log(`Embedding ${embeddable.length} ${SEMANTIC_INDEX_CORPUS} verses with ${EMBEDDING_MODEL}…`);

  for (let i = 0; i < embeddable.length; i += BATCH) {
    const batch = embeddable.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch.map((b) => b.text.trim()) });
    for (let j = 0; j < batch.length; j++) {
      const vec = formatVectorLiteral(res.data[j].embedding);
      const textHash = embeddingTextHash(batch[j].text);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "VerseEmbedding" ("verseId", "embedding", "model", "textHash", "createdAt")
        VALUES (${batch[j].id}, ${vec}::vector, ${EMBEDDING_MODEL}, ${textHash}, now())
        ON CONFLICT ("verseId") DO UPDATE
          SET "embedding" = EXCLUDED."embedding",
              "model" = EXCLUDED."model",
              "textHash" = EXCLUDED."textHash",
              "createdAt" = now()
      `);
    }
    console.log(`  ${Math.min(i + BATCH, embeddable.length)}/${embeddable.length}`);
  }

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
