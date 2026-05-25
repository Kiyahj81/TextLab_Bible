import { PrismaClient } from "@prisma/client";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ntBooks } from "../lib/references";

const prisma = new PrismaClient();

type Args = {
  morphgntDir?: string;
  morphgntUrlBase?: string;
  webUsfmDir?: string;
  maculaGreekTsv?: string;
  maculaGreekUrl?: string;
};

type ParsedMorphToken = {
  book: string;
  chapter: number;
  verse: number;
  wordIndex: number;
  surface: string;
  normalized: string;
  lemma: string;
  morphCode: string;
  partOfSpeech: string;
};

type ParsedMaculaRow = {
  book: string;
  chapter: number;
  verse: number;
  wordIndex: number;
  surface: string;
  gloss: string | null;
};

const DEFAULT_MACULA_GREEK_URL =
  "https://raw.githubusercontent.com/Clear-Bible/macula-greek/main/SBLGNT/tsv/macula-greek-SBLGNT.tsv";

type ParsedUsfmVerse = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

const morphGntFiles = [
  ["61-Mt-morphgnt.txt", "Matt"],
  ["62-Mk-morphgnt.txt", "Mark"],
  ["63-Lk-morphgnt.txt", "Luke"],
  ["64-Jn-morphgnt.txt", "John"],
  ["65-Ac-morphgnt.txt", "Acts"],
  ["66-Ro-morphgnt.txt", "Rom"],
  ["67-1Co-morphgnt.txt", "1Cor"],
  ["68-2Co-morphgnt.txt", "2Cor"],
  ["69-Ga-morphgnt.txt", "Gal"],
  ["70-Eph-morphgnt.txt", "Eph"],
  ["71-Php-morphgnt.txt", "Phil"],
  ["72-Col-morphgnt.txt", "Col"],
  ["73-1Th-morphgnt.txt", "1Thess"],
  ["74-2Th-morphgnt.txt", "2Thess"],
  ["75-1Ti-morphgnt.txt", "1Tim"],
  ["76-2Ti-morphgnt.txt", "2Tim"],
  ["77-Tit-morphgnt.txt", "Titus"],
  ["78-Phm-morphgnt.txt", "Phlm"],
  ["79-Heb-morphgnt.txt", "Heb"],
  ["80-Jas-morphgnt.txt", "Jas"],
  ["81-1Pe-morphgnt.txt", "1Pet"],
  ["82-2Pe-morphgnt.txt", "2Pet"],
  ["83-1Jn-morphgnt.txt", "1John"],
  ["84-2Jn-morphgnt.txt", "2John"],
  ["85-3Jn-morphgnt.txt", "3John"],
  ["86-Jud-morphgnt.txt", "Jude"],
  ["87-Re-morphgnt.txt", "Rev"]
] as const;

const usfmBookIds: Record<string, string> = {
  MAT: "Matt",
  MRK: "Mark",
  LUK: "Luke",
  JHN: "John",
  ACT: "Acts",
  ROM: "Rom",
  "1CO": "1Cor",
  "2CO": "2Cor",
  GAL: "Gal",
  EPH: "Eph",
  PHP: "Phil",
  COL: "Col",
  "1TH": "1Thess",
  "2TH": "2Thess",
  "1TI": "1Tim",
  "2TI": "2Tim",
  TIT: "Titus",
  PHM: "Phlm",
  HEB: "Heb",
  JAS: "Jas",
  "1PE": "1Pet",
  "2PE": "2Pet",
  "1JN": "1John",
  "2JN": "2John",
  "3JN": "3John",
  JUD: "Jude",
  REV: "Rev"
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (
    !args.morphgntDir &&
    !args.morphgntUrlBase &&
    !args.webUsfmDir &&
    !args.maculaGreekTsv &&
    !args.maculaGreekUrl
  ) {
    throw new Error(
      "Provide --morphgnt-dir, --morphgnt-url-base, --web-usfm-dir, --macula-greek-tsv, or --macula-greek-url. Example: npm run import:open-bible -- --morphgnt-url-base https://raw.githubusercontent.com/morphgnt/sblgnt/master"
    );
  }

  await ensureBooks();

  if (args.morphgntDir || args.morphgntUrlBase) {
    await importMorphGnt(args);
  }

  if (args.webUsfmDir) {
    await importWebUsfm(args.webUsfmDir);
  }

  if (args.maculaGreekTsv || args.maculaGreekUrl) {
    await importMaculaGreekGlosses(args);
  }
}

async function ensureBooks() {
  for (const book of ntBooks) {
    await prisma.book.upsert({
      where: { osisId: book.osisId },
      update: { name: book.name, order: book.order },
      create: { osisId: book.osisId, name: book.name, order: book.order }
    });
  }
}

async function importMorphGnt(args: Args) {
  const run = await prisma.importRun.create({
    data: {
      source: "MorphGNT SBLGNT",
      sourceUrl: args.morphgntUrlBase ?? args.morphgntDir,
      corpus: "SBLGNT",
      status: "running"
    }
  });

  let tokensImported = 0;
  const verseText = new Map<string, string[]>();

  try {
    const corpus = await prisma.corpus.upsert({
      where: { abbreviation: "SBLGNT" },
      update: {
        name: "SBL Greek New Testament",
        language: "Greek",
        license: "SBLGNT EULA; MorphGNT morphology CC-BY-SA",
        sourceUrl: args.morphgntUrlBase ?? "https://github.com/morphgnt/sblgnt"
      },
      create: {
        name: "SBL Greek New Testament",
        abbreviation: "SBLGNT",
        language: "Greek",
        license: "SBLGNT EULA; MorphGNT morphology CC-BY-SA",
        sourceUrl: args.morphgntUrlBase ?? "https://github.com/morphgnt/sblgnt"
      }
    });

    for (const [fileName, bookId] of morphGntFiles) {
      const content = args.morphgntUrlBase
        ? await fetchText(`${args.morphgntUrlBase.replace(/\/$/, "")}/${fileName}`)
        : await readFile(path.join(args.morphgntDir!, fileName), "utf8");
      const rows = parseMorphGnt(content, bookId);
      const book = await prisma.book.findUniqueOrThrow({ where: { osisId: bookId } });

      for (const row of rows) {
        const key = `${row.book}-${row.chapter}-${row.verse}`;
        verseText.set(key, [...(verseText.get(key) ?? []), row.surface]);

        await prisma.token.upsert({
          where: {
            corpusId_bookId_chapter_verse_wordIndex: {
              corpusId: corpus.id,
              bookId: book.id,
              chapter: row.chapter,
              verse: row.verse,
              wordIndex: row.wordIndex
            }
          },
          update: {
            surface: row.surface,
            normalized: row.normalized,
            lemma: row.lemma,
            morphCode: row.morphCode,
            partOfSpeech: row.partOfSpeech
          },
          create: {
            corpusId: corpus.id,
            bookId: book.id,
            chapter: row.chapter,
            verse: row.verse,
            wordIndex: row.wordIndex,
            surface: row.surface,
            normalized: row.normalized,
            lemma: row.lemma,
            morphCode: row.morphCode,
            partOfSpeech: row.partOfSpeech
          }
        });
        tokensImported++;
      }
    }

    let versesImported = 0;
    for (const [key, words] of verseText) {
      const [bookId, chapter, verse] = key.split("-");
      const book = await prisma.book.findUniqueOrThrow({ where: { osisId: bookId } });
      await prisma.verse.upsert({
        where: {
          corpusId_bookId_chapter_verse: {
            corpusId: corpus.id,
            bookId: book.id,
            chapter: Number(chapter),
            verse: Number(verse)
          }
        },
        update: { text: joinGreekVerse(words) },
        create: {
          corpusId: corpus.id,
          bookId: book.id,
          chapter: Number(chapter),
          verse: Number(verse),
          text: joinGreekVerse(words)
        }
      });
      versesImported++;
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        booksImported: morphGntFiles.length,
        versesImported,
        tokensImported,
        completedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: "failed", error: error instanceof Error ? error.message : String(error), completedAt: new Date() }
    });
    throw error;
  }
}

async function importMaculaGreekGlosses(args: Args) {
  const source = args.maculaGreekTsv ?? args.maculaGreekUrl ?? DEFAULT_MACULA_GREEK_URL;
  const run = await prisma.importRun.create({
    data: {
      source: "MACULA Greek SBLGNT glosses",
      sourceUrl: source,
      corpus: "SBLGNT",
      status: "running"
    }
  });

  try {
    const corpus = await prisma.corpus.findUnique({ where: { abbreviation: "SBLGNT" } });
    if (!corpus) {
      throw new Error("SBLGNT corpus not found. Run the MorphGNT import first.");
    }

    const content = args.maculaGreekTsv
      ? await readFile(args.maculaGreekTsv, "utf8")
      : await fetchText(args.maculaGreekUrl ?? DEFAULT_MACULA_GREEK_URL);

    const rows = parseMaculaTsv(content);

    const existingTokens = await prisma.token.findMany({
      where: { corpusId: corpus.id },
      select: {
        id: true,
        chapter: true,
        verse: true,
        wordIndex: true,
        surface: true,
        book: { select: { osisId: true } }
      }
    });
    const tokenIndex = new Map<string, { id: string; surface: string }>();
    for (const token of existingTokens) {
      const key = `${token.book.osisId}|${token.chapter}|${token.verse}|${token.wordIndex}`;
      tokenIndex.set(key, { id: token.id, surface: token.surface });
    }

    const updates: { id: string; gloss: string | null }[] = [];
    let missing = 0;
    let surfaceMismatch = 0;
    for (const row of rows) {
      const key = `${row.book}|${row.chapter}|${row.verse}|${row.wordIndex}`;
      const token = tokenIndex.get(key);
      if (!token) {
        missing++;
        continue;
      }
      if (row.surface && canonicalSurface(token.surface) !== canonicalSurface(row.surface)) {
        surfaceMismatch++;
        continue;
      }
      updates.push({ id: token.id, gloss: row.gloss });
    }

    const batchSize = 500;
    let applied = 0;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await prisma.$transaction(
        batch.map((u) =>
          prisma.token.update({ where: { id: u.id }, data: { gloss: u.gloss } })
        )
      );
      applied += batch.length;
    }

    console.log(
      `MACULA glosses: applied ${applied}, missing tokens ${missing}, surface mismatches ${surfaceMismatch}`
    );

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        tokensImported: applied,
        completedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      }
    });
    throw error;
  }
}

async function importWebUsfm(dir: string) {
  const run = await prisma.importRun.create({
    data: { source: "World English Bible USFM", sourceUrl: dir, corpus: "WEB", status: "running" }
  });

  try {
    const corpus = await prisma.corpus.upsert({
      where: { abbreviation: "WEB" },
      update: {
        name: "World English Bible",
        language: "English",
        license: "Public domain",
        sourceUrl: "https://ebible.org/details.php?id=engwebp"
      },
      create: {
        name: "World English Bible",
        abbreviation: "WEB",
        language: "English",
        license: "Public domain",
        sourceUrl: "https://ebible.org/details.php?id=engwebp"
      }
    });

    const files = (await readdir(dir)).filter((file) => file.toLowerCase().endsWith(".usfm"));
    let booksImported = 0;
    let versesImported = 0;

    for (const file of files) {
      const verses = parseUsfm(await readFile(path.join(dir, file), "utf8"));
      if (verses.length === 0) continue;
      booksImported++;

      for (const verse of verses) {
        const book = await prisma.book.findUniqueOrThrow({ where: { osisId: verse.book } });
        await prisma.verse.upsert({
          where: {
            corpusId_bookId_chapter_verse: {
              corpusId: corpus.id,
              bookId: book.id,
              chapter: verse.chapter,
              verse: verse.verse
            }
          },
          update: { text: verse.text },
          create: {
            corpusId: corpus.id,
            bookId: book.id,
            chapter: verse.chapter,
            verse: verse.verse,
            text: verse.text
          }
        });
        versesImported++;
      }
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: "completed", booksImported, versesImported, completedAt: new Date() }
    });
  } catch (error) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: "failed", error: error instanceof Error ? error.message : String(error), completedAt: new Date() }
    });
    throw error;
  }
}

function parseMorphGnt(content: string, book: string): ParsedMorphToken[] {
  const counters = new Map<string, number>();

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 7) {
        throw new Error(`Invalid MorphGNT row: ${line}`);
      }

      const [bcv, partOfSpeech, parsingCode, surface, word, normalized, lemma] = columns;
      const chapter = Number(bcv.slice(2, 4));
      const verse = Number(bcv.slice(4, 6));
      const key = `${book}-${chapter}-${verse}`;
      const wordIndex = (counters.get(key) ?? 0) + 1;
      counters.set(key, wordIndex);

      return {
        book,
        chapter,
        verse,
        wordIndex,
        surface,
        normalized: normalized || word,
        lemma,
        morphCode: `${partOfSpeech}${parsingCode.replace(/^-+/, "")}`.replace(/-+$/, ""),
        partOfSpeech
      };
    });
}

function canonicalSurface(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[⸀-⹿]/g, "")
    .replace(/;/g, ";")
    .replace(/·/g, "·");
}

function parseMaculaTsv(content: string): ParsedMaculaRow[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = lines[0].split("\t");
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`MACULA TSV missing column: ${name}`);
    return idx;
  };
  const refIdx = col("ref");
  const englishIdx = col("english");
  const glossIdx = col("gloss");
  const textIdx = col("text");
  const afterIdx = col("after");

  const rows: ParsedMaculaRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split("\t");
    const ref = cells[refIdx];
    if (!ref) continue;

    const match = ref.match(/^([A-Z1-3]{3})\s+(\d+):(\d+)!(\d+)$/);
    if (!match) continue;
    const [, usfmBook, chapter, verse, wordIndex] = match;
    const osisId = usfmBookIds[usfmBook];
    if (!osisId) continue;

    const english = (cells[englishIdx] ?? "").trim();
    const rawGloss = (cells[glossIdx] ?? "").trim();
    const fallbackGloss = rawGloss && rawGloss !== "-" ? rawGloss : "";
    const gloss = english || fallbackGloss || null;

    const text = cells[textIdx] ?? "";
    const afterPunct = (cells[afterIdx] ?? "").replace(/\s+/g, "");

    rows.push({
      book: osisId,
      chapter: Number(chapter),
      verse: Number(verse),
      wordIndex: Number(wordIndex),
      surface: text + afterPunct,
      gloss
    });
  }
  return rows;
}

function parseUsfm(content: string): ParsedUsfmVerse[] {
  const verses: ParsedUsfmVerse[] = [];
  let book: string | undefined;
  let chapter: number | undefined;

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("\\id ")) {
      const id = line.split(/\s+/)[1]?.toUpperCase();
      book = id ? usfmBookIds[id] : undefined;
    }
    if (line.startsWith("\\c ")) {
      chapter = Number(line.split(/\s+/)[1]);
    }
    if (line.startsWith("\\v ") && book && chapter) {
      const match = line.match(/^\\v\s+(\d+)\s+(.+)$/);
      if (match) {
        verses.push({
          book,
          chapter,
          verse: Number(match[1]),
          text: cleanUsfmText(match[2])
        });
      }
    }
  }

  return verses;
}

function cleanUsfmText(text: string) {
  return text
    .replace(/\\f\s+.*?\\f\*/gi, "")
    .replace(/\\x\s+.*?\\x\*/gi, "")
    .replace(/\\\+?w\s+([^|\\]+)(?:\|[^\\]*)?\\\+?w\*/gi, "$1")
    .replace(/\\[a-z0-9+*]+\s?/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function joinGreekVerse(words: string[]) {
  return words.join(" ").replace(/\s+([,.;:!?])/g, "$1");
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function parseArgs(args: string[]): Args {
  const parsed: Args = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--morphgnt-dir") {
      parsed.morphgntDir = value;
      index++;
    } else if (arg === "--morphgnt-url-base") {
      parsed.morphgntUrlBase = value;
      index++;
    } else if (arg === "--web-usfm-dir") {
      parsed.webUsfmDir = value;
      index++;
    } else if (arg === "--macula-greek-tsv") {
      parsed.maculaGreekTsv = value;
      index++;
    } else if (arg === "--macula-greek-url") {
      parsed.maculaGreekUrl = value;
      index++;
    }
  }

  if (parsed.morphgntDir) parsed.morphgntDir = path.resolve(parsed.morphgntDir);
  if (parsed.webUsfmDir) parsed.webUsfmDir = path.resolve(parsed.webUsfmDir);
  if (parsed.maculaGreekTsv) parsed.maculaGreekTsv = path.resolve(parsed.maculaGreekTsv);

  return parsed;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
