import { Prisma } from "@prisma/client";
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

export async function searchKeyword(input: {
  corpus?: string;
  query: string;
  book?: string;
  chapter?: number;
  orderBy?: "canonical" | "rank";
} & PaginationInput) {
  const book = normalizeBook(input.book);
  const query = input.query.trim();
  const pagination = normalizePagination(input);

  if (!query) {
    return { query, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  // websearch_to_tsquery never throws on arbitrary user/assistant input (stray
  // punctuation, quotes, -exclusion all tolerated). All values are bound as
  // parameters — no string interpolation into SQL.
  const tsquery = Prisma.sql`websearch_to_tsquery('bible_simple', ${query})`;

  // Corpus filter mirrors the prior Prisma behavior: explicit corpus, else any
  // corpus except NET.
  const corpusFilter = input.corpus
    ? Prisma.sql`c."abbreviation" = ${input.corpus}`
    : Prisma.sql`c."abbreviation" <> 'NET'`;

  const filters: Prisma.Sql[] = [Prisma.sql`v."textSearch" @@ ${tsquery}`, corpusFilter];
  if (book) filters.push(Prisma.sql`b."osisId" = ${book}`);
  if (input.chapter !== undefined) filters.push(Prisma.sql`v."chapter" = ${input.chapter}`);
  const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

  // In rank mode the tsquery is embedded twice (the @@ filter and ts_rank), so
  // Postgres evaluates websearch_to_tsquery once per use — negligible at NT-corpus
  // scale. If profiling ever shows overhead, compute the tsquery once in a CTE.
  const orderSql =
    input.orderBy === "rank"
      ? Prisma.sql`ORDER BY ts_rank(v."textSearch", ${tsquery}) DESC, b."order" ASC, v."chapter" ASC, v."verse" ASC`
      : Prisma.sql`ORDER BY b."order" ASC, v."chapter" ASC, v."verse" ASC`;

  const offset = (pagination.page - 1) * pagination.pageSize;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM "Verse" v
      JOIN "Corpus" c ON c."id" = v."corpusId"
      JOIN "Book" b ON b."id" = v."bookId"
      ${whereSql}
    `),
    prisma.$queryRaw<
      { corpus: string; osisId: string; chapter: number; verse: number; text: string }[]
    >(Prisma.sql`
      SELECT c."abbreviation" AS corpus, b."osisId" AS "osisId",
             v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Corpus" c ON c."id" = v."corpusId"
      JOIN "Book" b ON b."id" = v."bookId"
      ${whereSql}
      ${orderSql}
      LIMIT ${pagination.pageSize} OFFSET ${offset}
    `)
  ]);

  const total = Number(countRows[0]?.count ?? BigInt(0));

  return {
    query,
    pagination: paginationResult(pagination, total),
    results: rows.map((row) => ({
      corpus: row.corpus,
      reference: formatReference(row.osisId, row.chapter, row.verse),
      text: row.text
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

// DB take is bounded to lemmas.length * perLemma + 50 (cushion so JS-side per-lemma cap of `perLemma` can still fill each bucket if Prisma's row distribution is slightly weighted toward high-frequency lemmas).
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
    orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }],
    take: input.lemmas.length * perLemma + 50
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

export const LEMMA_STOP_WORDS: ReadonlySet<string> = new Set([
  "εἰμί", "πᾶς", "λέγω", "γίνομαι", "ἔχω", "ποιέω"
]);
export const CONTENT_PART_OF_SPEECH = ["N-", "V-", "A-"] as const;

export async function getTopLemmas(input: {
  corpus?: "SBLGNT";
  book?: string;
  limit?: number;
}) {
  const book = normalizeBook(input.book);
  const limit = Math.max(1, Math.min(input.limit ?? 10, 25));

  const rows = await prisma.token.groupBy({
    by: ["lemma", "partOfSpeech"],
    where: {
      corpus: { abbreviation: input.corpus ?? "SBLGNT" },
      book: book ? { osisId: book } : undefined,
      lemma: { not: null, notIn: Array.from(LEMMA_STOP_WORDS) },
      partOfSpeech: { in: [...CONTENT_PART_OF_SPEECH] }
    },
    _count: { _all: true },
    orderBy: { _count: { lemma: "desc" } },
    take: limit
  });

  return rows.map((row) => ({
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
