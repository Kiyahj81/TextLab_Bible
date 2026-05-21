import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookName, formatReference, normalizeBook } from "@/lib/references";

type PassageInput = {
  corpus: "SBLGNT" | "WEB";
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
};

type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export type SearchPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
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
        corpus: { abbreviation: "WEB" },
        book: { osisId: book },
        chapter
      },
      include: { book: true, corpus: true },
      orderBy: [{ corpus: { abbreviation: "asc" } }, { verse: "asc" }]
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

  const englishByVerse = new Map<number, (typeof englishVerses)[number]>();
  for (const verse of englishVerses) {
    englishByVerse.set(verse.verse, verse);
  }

  return greekVerses.map((verse) => ({
    id: verse.id,
    book: verse.book.osisId,
    bookName: verse.book.name,
    chapter: verse.chapter,
    verse: verse.verse,
    reference: formatReference(verse.book.osisId, verse.chapter, verse.verse),
    greekText: verse.text,
    englishText: englishByVerse.get(verse.verse)?.text ?? "",
    englishCorpus: englishByVerse.get(verse.verse)?.corpus.abbreviation ?? "WEB",
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
} & PaginationInput) {
  const book = normalizeBook(input.book);
  const query = input.query.trim();
  const pagination = normalizePagination(input);

  if (!query) {
    return { query, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  const where: Prisma.VerseWhereInput = {
      text: { contains: query, mode: "insensitive" },
      corpus: input.corpus ? { abbreviation: input.corpus } : { abbreviation: { not: "NET" } },
      book: book ? { osisId: book } : undefined,
      chapter: input.chapter
    };

  const [total, verses] = await Promise.all([
    prisma.verse.count({ where }),
    prisma.verse.findMany({
    where,
    include: { corpus: true, book: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize
    })
  ]);

  return {
    query,
    pagination: paginationResult(pagination, total),
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
  chapter?: number;
} & PaginationInput) {
  const lemma = input.lemma.trim();
  const book = normalizeBook(input.book);
  const pagination = normalizePagination(input);

  if (!lemma) {
    return { lemma, count: 0, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  const where: Prisma.TokenWhereInput = {
      lemma,
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined,
      chapter: input.chapter
    };

  const [total, tokens] = await Promise.all([
    prisma.token.count({ where }),
    prisma.token.findMany({
    where,
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize
    })
  ]);

  const results = await hydrateTokens(tokens);

  return {
    lemma,
    count: total,
    pagination: paginationResult(pagination, total),
    results
  };
}

export async function searchMorphology(input: {
  morphCode: string;
  matchMode: "exact" | "prefix";
  corpus?: "SBLGNT";
  book?: string;
  chapter?: number;
} & PaginationInput) {
  const morphCode = input.morphCode.trim();
  const book = normalizeBook(input.book);
  const pagination = normalizePagination(input);

  if (!morphCode) {
    return { morphCode, count: 0, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  const where: Prisma.TokenWhereInput = {
      morphCode:
        input.matchMode === "prefix"
          ? { startsWith: morphCode, mode: "insensitive" as const }
          : { equals: morphCode, mode: "insensitive" as const },
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined,
      chapter: input.chapter
    };

  const [total, tokens] = await Promise.all([
    prisma.token.count({ where }),
    prisma.token.findMany({
    where,
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize
    })
  ]);

  const results = await hydrateTokens(tokens);

  return {
    morphCode,
    count: total,
    pagination: paginationResult(pagination, total),
    results
  };
}

export async function findLemmaExamples(input: {
  lemmas: string[];
  corpus?: "SBLGNT";
  book?: string;
  perLemma?: number;
}) {
  if (input.lemmas.length === 0) return new Map<string, Awaited<ReturnType<typeof hydrateTokens>>>();
  const book = normalizeBook(input.book);
  const perLemma = Math.max(1, Math.min(input.perLemma ?? 5, 25));

  const tokens = await prisma.token.findMany({
    where: {
      lemma: { in: input.lemmas },
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined
    },
    include: { book: true, corpus: true },
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }]
  });

  const grouped = new Map<string, typeof tokens>();
  for (const token of tokens) {
    if (!token.lemma) continue;
    const bucket = grouped.get(token.lemma) ?? [];
    if (bucket.length < perLemma) bucket.push(token);
    grouped.set(token.lemma, bucket);
  }

  const flat = Array.from(grouped.values()).flat();
  const hydrated = await hydrateTokens(flat);
  const byId = new Map(hydrated.map((row) => [row.tokenId, row]));

  const out = new Map<string, typeof hydrated>();
  for (const [lemma, bucket] of grouped) {
    out.set(lemma, bucket.map((t) => byId.get(t.id)!).filter(Boolean));
  }
  return out;
}

export async function getTopLemmas(input: {
  corpus?: "SBLGNT";
  book?: string;
  limit?: number;
}) {
  const book = normalizeBook(input.book);
  const limit = Math.max(1, Math.min(input.limit ?? 10, 25));
  const stopLemmas = new Set(["εἰμί", "πᾶς", "λέγω", "γίνομαι", "ἔχω", "ποιέω"]);

  const rows = await prisma.token.groupBy({
    by: ["lemma", "partOfSpeech"],
    where: {
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined,
      lemma: { not: null },
      partOfSpeech: { in: ["N-", "V-", "A-"] }
    },
    _count: { _all: true },
    orderBy: { _count: { lemma: "desc" } },
    take: limit + stopLemmas.size + 10
  });

  return rows
    .filter((row) => Boolean(row.lemma) && !stopLemmas.has(row.lemma ?? ""))
    .slice(0, limit)
    .map((row) => ({
      lemma: row.lemma ?? "",
      partOfSpeech: row.partOfSpeech ?? "",
      count: row._count._all
    }));
}

function normalizePagination(input: PaginationInput) {
  const page = Number.isFinite(input.page) && input.page && input.page > 0 ? Math.floor(input.page) : 1;
  const requestedPageSize =
    Number.isFinite(input.pageSize) && input.pageSize && input.pageSize > 0 ? Math.floor(input.pageSize) : 25;

  return {
    page,
    pageSize: Math.min(requestedPageSize, 100)
  };
}

function paginationResult(pagination: { page: number; pageSize: number }, total: number): SearchPagination {
  return {
    ...pagination,
    total,
    pageCount: Math.ceil(total / pagination.pageSize)
  };
}

type HydratedToken = {
  id: string;
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  chapter: number;
  verse: number;
  book: { id: string; osisId: string };
  corpus: { abbreviation: string };
};

async function hydrateTokens(tokens: HydratedToken[]) {
  if (tokens.length === 0) return [];

  const bookIds = Array.from(new Set(tokens.map((t) => t.book.id)));
  const corpora = Array.from(new Set(tokens.map((t) => t.corpus.abbreviation)));

  const verses = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: { in: corpora } },
      bookId: { in: bookIds },
      OR: tokens.map((t) => ({ bookId: t.book.id, chapter: t.chapter, verse: t.verse }))
    },
    select: { bookId: true, chapter: true, verse: true, text: true, corpus: { select: { abbreviation: true } } }
  });

  const key = (bookId: string, chapter: number, verse: number, corpus: string) =>
    `${corpus}|${bookId}|${chapter}|${verse}`;

  const verseText = new Map<string, string>();
  for (const v of verses) {
    verseText.set(key(v.bookId, v.chapter, v.verse, v.corpus.abbreviation), v.text);
  }

  return tokens.map((token) => ({
    tokenId: token.id,
    corpus: token.corpus.abbreviation,
    reference: formatReference(token.book.osisId, token.chapter, token.verse),
    surface: token.surface,
    lemma: token.lemma ?? "",
    morphCode: token.morphCode ?? "",
    verseText: verseText.get(key(token.book.id, token.chapter, token.verse, token.corpus.abbreviation)) ?? ""
  }));
}
