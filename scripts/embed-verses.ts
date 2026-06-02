import { PrismaClient, Prisma } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();
const MODEL = "text-embedding-3-small";
const SEMANTIC_INDEX_CORPUS = "WEB";
const BATCH = 100;

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required to embed verses.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey });

  // Idempotent/resumable: only verses in the index corpus with no embedding row.
  const pending = await prisma.$queryRaw<{ id: string; text: string }[]>(Prisma.sql`
    SELECT v."id" AS id, v."text" AS text
    FROM "Verse" v
    JOIN "Corpus" c ON c."id" = v."corpusId"
    LEFT JOIN "VerseEmbedding" e ON e."verseId" = v."id"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} AND e."verseId" IS NULL
    ORDER BY v."id"
  `);

  const embeddable = pending.filter((v) => v.text.trim().length > 0);
  const skipped = pending.length - embeddable.length;
  if (skipped > 0) console.log(`Skipping ${skipped} empty/whitespace-only verse(s).`);

  console.log(`Embedding ${embeddable.length} ${SEMANTIC_INDEX_CORPUS} verses with ${MODEL}…`);

  for (let i = 0; i < embeddable.length; i += BATCH) {
    const batch = embeddable.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: MODEL, input: batch.map((b) => b.text) });
    for (let j = 0; j < batch.length; j++) {
      const vec = vectorLiteral(res.data[j].embedding);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "VerseEmbedding" ("verseId", "embedding", "model", "createdAt")
        VALUES (${batch[j].id}, ${vec}::vector, ${MODEL}, now())
        ON CONFLICT ("verseId") DO UPDATE
          SET "embedding" = EXCLUDED."embedding", "model" = EXCLUDED."model", "createdAt" = now()
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
