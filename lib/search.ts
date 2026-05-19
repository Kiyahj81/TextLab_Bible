import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";

type PassageInput = {
  corpus: "SBLGNT" | "NET";
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
};

export type Citation = {
  corpus: string;
  reference: string;
  searchQuery?: string;
  tokenId?: string;
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

export async function getReaderPassage(bookInput = "John", chapter = 1) {
  const book = normalizeBook(bookInput) ?? "John";

  const [greekVerses, englishVerses, tokens] = await Promise.all([
    prisma.verse.findMany({
      where: {
        corpus: { abbreviation: "SBLGNT" },
        book: { osisId: book },
        chapter
      },
      include: { book: true, highlights: true },
      orderBy: { verse: "asc" }
    }),
    prisma.verse.findMany({
      where: {
        corpus: { abbreviation: "NET" },
        book: { osisId: book },
        chapter
      },
      include: { book: true },
      orderBy: { verse: "asc" }
    }),
    prisma.token.findMany({
      where: {
        corpus: { abbreviation: "SBLGNT" },
        book: { osisId: book },
        chapter
      },
      include: { book: true, notes: true, highlights: true },
      orderBy: [{ verse: "asc" }, { wordIndex: "asc" }]
    })
  ]);

  const tokensByVerse = tokens.reduce<Record<number, typeof tokens>>((acc, token) => {
    acc[token.verse] = acc[token.verse] ?? [];
    acc[token.verse].push(token);
    return acc;
  }, {});

  const englishByVerse = new Map(englishVerses.map((verse) => [verse.verse, verse]));

  return greekVerses.map((verse) => ({
    id: verse.id,
    book: verse.book.osisId,
    bookName: verse.book.name,
    chapter: verse.chapter,
    verse: verse.verse,
    reference: formatReference(verse.book.osisId, verse.chapter, verse.verse),
    greekText: verse.text,
    englishText: englishByVerse.get(verse.verse)?.text ?? "",
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
      noteCount: token.notes.length,
      highlighted: token.highlights.length > 0
    })),
    highlighted: verse.highlights.length > 0
  }));
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

export async function searchKeyword(input: {
  corpus?: string;
  query: string;
  book?: string;
  chapter?: number;
}) {
  const book = normalizeBook(input.book);
  const query = input.query.trim();

  if (!query) {
    return { query, results: [] };
  }

  const verses = await prisma.verse.findMany({
    where: {
      text: { contains: query, mode: "insensitive" },
      corpus: input.corpus ? { abbreviation: input.corpus } : undefined,
      book: book ? { osisId: book } : undefined,
      chapter: input.chapter
    },
    include: { corpus: true, book: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }]
  });

  return {
    query,
    results: verses.map((verse) => ({
      corpus: verse.corpus.abbreviation,
      reference: formatReference(verse.book.osisId, verse.chapter, verse.verse),
      text: verse.text
    }))
  };
}

export async function searchLemma(input: {
  lemma: string;
  corpus?: "SBLGNT";
  book?: string;
}) {
  const lemma = input.lemma.trim();
  const book = normalizeBook(input.book);

  if (!lemma) {
    return { lemma, count: 0, results: [] };
  }

  const tokens = await prisma.token.findMany({
    where: {
      lemma,
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined
    },
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }]
  });

  const results = await Promise.all(tokens.map(tokenToSearchResult));

  return {
    lemma,
    count: results.length,
    results
  };
}

export async function searchMorphology(input: {
  morphCode: string;
  matchMode: "exact" | "prefix";
  corpus?: "SBLGNT";
  book?: string;
}) {
  const morphCode = input.morphCode.trim();
  const book = normalizeBook(input.book);

  if (!morphCode) {
    return { morphCode, count: 0, results: [] };
  }

  const tokens = await prisma.token.findMany({
    where: {
      morphCode:
        input.matchMode === "prefix"
          ? { startsWith: morphCode, mode: "insensitive" }
          : { equals: morphCode, mode: "insensitive" },
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined
    },
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }]
  });

  const results = await Promise.all(tokens.map(tokenToSearchResult));

  return {
    morphCode,
    count: results.length,
    results
  };
}

async function tokenToSearchResult(token: {
  id: string;
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  chapter: number;
  verse: number;
  book: { id: string; osisId: string };
  corpus: { abbreviation: string };
}) {
  const verse = await prisma.verse.findFirst({
    where: {
      corpus: { abbreviation: token.corpus.abbreviation },
      bookId: token.book.id,
      chapter: token.chapter,
      verse: token.verse
    }
  });

  return {
    tokenId: token.id,
    corpus: token.corpus.abbreviation,
    reference: formatReference(token.book.osisId, token.chapter, token.verse),
    surface: token.surface,
    lemma: token.lemma ?? "",
    morphCode: token.morphCode ?? "",
    verseText: verse?.text ?? ""
  };
}
