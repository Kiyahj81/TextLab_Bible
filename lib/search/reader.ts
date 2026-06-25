import { prisma } from "@/lib/db";
import { bookName, formatReference, normalizeBook } from "@/lib/references";
import { resolveTokenDomains } from "@/lib/louwNida";

type PassageInput = {
  corpus: "SBLGNT" | "WEB";
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
};

export async function getAvailablePassages() {
  const rows = await prisma.verse.findMany({
    where: { corpus: { abbreviation: "SBLGNT" } },
    include: { book: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }]
  });

  const unique = new Map<string, { book: string; label: string; chapter: number }>();

  for (const row of rows) {
    const key = `${row.book.osisId}-${row.chapter}`;
    if (!unique.has(key)) {
      unique.set(key, {
        book: row.book.osisId,
        label: `${row.book.name} ${row.chapter}`,
        chapter: row.chapter
      });
    }
  }

  return Array.from(unique.values());
}

export async function getAvailableReaderBooks() {
  const rows = await prisma.verse.findMany({
    where: { corpus: { abbreviation: "SBLGNT" } },
    select: { book: true },
    distinct: ["bookId"],
    orderBy: { book: { order: "asc" } }
  });

  return rows.map((row) => ({
    osisId: row.book.osisId,
    name: row.book.name,
    label: bookName(row.book.osisId)
  }));
}

export type PassageNeighbor = { book: string; chapter: number };

export async function getPassageNeighbors(
  bookInput: string,
  chapter: number
): Promise<{ prev: PassageNeighbor | null; next: PassageNeighbor | null }> {
  const book = normalizeBook(bookInput) ?? bookInput;

  const rows = await prisma.verse.findMany({
    where: { corpus: { abbreviation: "SBLGNT" }, book: { osisId: book } },
    select: { chapter: true },
    distinct: ["chapter"],
    orderBy: { chapter: "asc" }
  });

  const chapters = rows.map((row) => row.chapter);
  if (chapters.length === 0) return { prev: null, next: null };

  const index = chapters.indexOf(chapter);
  const prevChapter = index > 0 ? chapters[index - 1] : null;
  const nextChapter = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  return {
    prev: prevChapter !== null ? { book, chapter: prevChapter } : null,
    next: nextChapter !== null ? { book, chapter: nextChapter } : null
  };
}

export async function getReaderPassage(bookInput = "John", chapter = 1, userId: string | null = null) {
  const book = normalizeBook(bookInput) ?? "John";

  // When userId is null (anonymous reader pre-auth or test paths) we
  // include no notes/highlights. Filtering with a userId that matches no
  // rows yields the same result without leaking another user's data.
  const userScope = userId ? { userId } : { userId: "__none__" };

  const [greekVerses, englishVerses, tokens] = await Promise.all([
    prisma.verse.findMany({
      where: {
        corpus: { abbreviation: "SBLGNT" },
        book: { osisId: book },
        chapter
      },
      include: { book: true },
      orderBy: { verse: "asc" }
    }),
    prisma.verse.findMany({
      where: {
        corpus: { abbreviation: "WEB" },
        book: { osisId: book },
        chapter
      },
      include: {
        book: true,
        corpus: true,
        highlights: { where: userScope }
      },
      orderBy: [{ corpus: { abbreviation: "asc" } }, { verse: "asc" }]
    }),
    prisma.token.findMany({
      where: {
        corpus: { abbreviation: "SBLGNT" },
        book: { osisId: book },
        chapter
      },
      include: {
        book: true,
        notes: { where: userScope },
        highlights: { where: userScope }
      },
      orderBy: [{ verse: "asc" }, { wordIndex: "asc" }]
    })
  ]);

  const domainCodes = new Set<string>();
  for (const token of tokens) {
    for (const code of token.lnDomain) {
      domainCodes.add(code);
      if (code.length > 3) domainCodes.add(code.slice(0, 3));
    }
  }
  const domainLabelRows = domainCodes.size
    ? await prisma.louwNidaDomain.findMany({
        where: { code: { in: Array.from(domainCodes) } },
        select: { code: true, label: true }
      })
    : [];
  const domainLabels = new Map(domainLabelRows.map((row) => [row.code, row.label]));

  const verseNotes = await prisma.note.findMany({
    where: { ...userScope, verseId: { in: greekVerses.map((v) => v.id) } },
    select: { id: true, title: true, body: true, tags: true, verseId: true },   // createdAt removed
    orderBy: { createdAt: "asc" }
  });
  const notesByVerse = new Map<string, { id: string; title: string | null; body: string; tags: string[] }[]>();
  for (const n of verseNotes) {
    if (!n.verseId) continue;
    const list = notesByVerse.get(n.verseId) ?? [];
    list.push({ id: n.id, title: n.title, body: n.body, tags: n.tags });
    notesByVerse.set(n.verseId, list);
  }

  const tokensByVerse = tokens.reduce<Record<number, typeof tokens>>((acc, token) => {
    acc[token.verse] = acc[token.verse] ?? [];
    acc[token.verse].push(token);
    return acc;
  }, {});

  const englishByVerse = new Map<number, (typeof englishVerses)[number]>();
  for (const verse of englishVerses) {
    englishByVerse.set(verse.verse, verse);
  }

  return greekVerses.map((verse) => {
    const englishVerse = englishByVerse.get(verse.verse);
    return {
      id: verse.id,
      book: verse.book.osisId,
      bookName: verse.book.name,
      chapter: verse.chapter,
      verse: verse.verse,
      reference: formatReference(verse.book.osisId, verse.chapter, verse.verse),
      greekText: verse.text,
      englishText: englishVerse?.text ?? "",
      englishCorpus: englishVerse?.corpus.abbreviation ?? "WEB",
      englishVerseId: englishVerse?.id ?? null,
      englishHighlights: collectEnglishHighlights(englishVerse?.highlights ?? []),
      notes: notesByVerse.get(verse.id) ?? [],
      tokens: (tokensByVerse[verse.verse] ?? []).map((token) => ({
        id: token.id,
        book: token.book.osisId,
        chapter: token.chapter,
        verse: token.verse,
        wordIndex: token.wordIndex,
        surface: token.surface,
        normalized: token.normalized,
        lemma: token.lemma,
        morphCode: token.morphCode,
        partOfSpeech: token.partOfSpeech,
        gloss: token.gloss,
        domains: resolveTokenDomains(token.louwNida, token.lnDomain, domainLabels),
        noteCount: token.notes.length,
        notes: token.notes.map((n) => ({ id: n.id, title: n.title, body: n.body, tags: n.tags })),
        highlightColor: latestHighlightColor(token.highlights)
      }))
    };
  });
}

function collectEnglishHighlights(
  highlights: { englishWordIndex: number | null; color: string; createdAt: Date }[]
): Array<{ wordIndex: number; color: string }> {
  const byWord = new Map<number, { color: string; createdAt: Date }>();
  for (const entry of highlights) {
    if (entry.englishWordIndex === null || entry.englishWordIndex === undefined) continue;
    const existing = byWord.get(entry.englishWordIndex);
    if (!existing || entry.createdAt > existing.createdAt) {
      byWord.set(entry.englishWordIndex, { color: entry.color, createdAt: entry.createdAt });
    }
  }
  return Array.from(byWord.entries()).map(([wordIndex, { color }]) => ({ wordIndex, color }));
}

function latestHighlightColor(
  highlights: { color: string; createdAt: Date }[]
): string | null {
  if (highlights.length === 0) return null;
  return highlights.reduce((latest, current) =>
    current.createdAt > latest.createdAt ? current : latest
  ).color;
}

export async function getPassage(input: PassageInput) {
  const book = normalizeBook(input.book) ?? input.book;
  const end = input.verseEnd ?? input.verseStart;
  const verses = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: input.corpus },
      book: { osisId: book },
      chapter: input.chapter,
      verse: { gte: input.verseStart, lte: end }
    },
    include: { book: true, corpus: true },
    orderBy: { verse: "asc" }
  });

  return {
    corpus: input.corpus,
    references: verses.map((verse) => ({
      book: verse.book.osisId,
      chapter: verse.chapter,
      verse: verse.verse,
      reference: formatReference(verse.book.osisId, verse.chapter, verse.verse),
      text: verse.text
    }))
  };
}
