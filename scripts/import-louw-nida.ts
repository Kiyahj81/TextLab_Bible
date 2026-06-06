import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { flattenLouwNidaDomains } from "../lib/louwNida";

const prisma = new PrismaClient();

const DATA_FILE = path.join(
  process.cwd(),
  "data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON"
);

async function main() {
  const json: unknown = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const rows = flattenLouwNidaDomains(json);
  if (rows.length === 0) {
    throw new Error(`No Louw-Nida domain rows parsed from ${DATA_FILE}`);
  }

  const batchSize = 500;
  let applied = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.louwNidaDomain.upsert({
          where: { code: row.code },
          create: row,
          update: { level: row.level, label: row.label, parentCode: row.parentCode }
        })
      )
    );
    applied += batch.length;
  }

  console.log(`Upserted ${applied} Louw-Nida domain rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
