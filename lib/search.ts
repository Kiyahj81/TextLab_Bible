import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookName, formatReference, normalizeBook } from "@/lib/references";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";
import { EMBEDDING_MODEL, SEMANTIC_INDEX_CORPUS, formatVectorLiteral } from "@/lib/search/semanticIndex";
import { rerankCandidates } from "@/lib/search/rerank";
import { resolveTokenDomains } from "@/lib/louwNida";
import { normalizeMorphCodeQuery } from "@/lib/morphology";

export {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "@/lib/search/semanticIndex";

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

export function spineKey(book: string, chapter: number, verse: number): string {
  return `${book}|${chapter}|${verse}`;
}

// Given candidate references, return the set of spineKeys that EXIST in SBLGNT.
// Used to drop WEB-only verses (e.g. Acts 8:37) before they reach synthesis, so a
// cited reference can never be unresolvable on the citation spine.
export async function filterToSblSpine(
  refs: { book: string; chapter: number; verse: number }[]
): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: "SBLGNT" },
      OR: refs.map((r) => ({ book: { osisId: r.book }, chapter: r.chapter, verse: r.verse }))
    },
    select: { chapter: true, verse: true, book: { select: { osisId: true } } }
  });
  return new Set(rows.map((r) => spineKey(r.book.osisId, r.chapter, r.verse)));
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const client = getOpenAi();
  const input = text.trim();
  if (!client || !input) return null;
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input });
  return res.data[0]?.embedding ?? null;
}

type SemanticRow = { osisId: string; chapter: number; verse: number; text: string };

// Hybrid semantic search: vector KNN over the embedded WEB index fused with a
// keyword FTS pass, then filtered to the SBLGNT spine. `query` is embedded (full
// natural-language prompt); `keywords` drives the FTS half (distilled topic words —
// bible_simple keeps stopwords, so the full prompt would AND to nothing). Returns
// [] when no OpenAI client (embedQuery null).
// Architecture-doc top-30 → top-5: cap the reranker input to 30 candidates.
// onSpine can exceed 30 (up to 30 vector + 30 FTS rows fused), so cap explicitly.
// Set `rerank: false` to skip the Voyage rerank stage and return the RRF-ordered slice
// (used by the rerank-diff harness); the default reranks when `AI_GATEWAY_API_KEY` is set.
const RERANK_CANDIDATE_LIMIT = 30;

type SemanticSearchInput = {
  query: string;
  keywords?: string;
  book?: string;
  chapter?: number;
  limit?: number;
  rerank?: boolean;
};

export type SemanticRerankStatus = "applied" | "fallback" | "disabled";

export type SemanticRerankTrace = {
  status: SemanticRerankStatus;
  candidateCount: number;
};

export type SemanticSearchDetailedResult = {
  results: RankedRef[];
  rerank: SemanticRerankTrace;
};

function semanticResult(results: RankedRef[], rerank: SemanticRerankTrace): SemanticSearchDetailedResult {
  return { results, rerank };
}

export async function searchSemantic(input: SemanticSearchInput): Promise<RankedRef[]> {
  return (await searchSemanticDetailed(input)).results;
}

export async function searchSemanticDetailed(input: SemanticSearchInput): Promise<SemanticSearchDetailedResult> {
  const query = input.query.trim();
  if (!query) return semanticResult([], { status: "disabled", candidateCount: 0 });
  const vector = await embedQuery(query);
  if (!vector) return semanticResult([], { status: "disabled", candidateCount: 0 });

  const book = normalizeBook(input.book);
  const limit = Math.max(1, Math.min(input.limit ?? 5, 25));
  const POOL = 30;
  const vec = formatVectorLiteral(vector);
  // Scope both halves identically to the deterministic calls: optional book, and —
  // when the prompt names a single bare chapter — that chapter, so semantic hits don't
  // bleed in from other chapters.
  const bookFilter = book ? Prisma.sql`AND b."osisId" = ${book}` : Prisma.empty;
  const chapterFilter = input.chapter !== undefined ? Prisma.sql`AND v."chapter" = ${input.chapter}` : Prisma.empty;

  const vectorRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
    SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
    FROM "VerseEmbedding" e
    JOIN "Verse" v ON v."id" = e."verseId"
    JOIN "Book" b ON b."id" = v."bookId"
    JOIN "Corpus" c ON c."id" = v."corpusId"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS}
      AND e."model" = ${EMBEDDING_MODEL}
      ${bookFilter} ${chapterFilter}
    ORDER BY e."embedding" <=> ${vec}::vector
    LIMIT ${POOL}
  `);

  const keywords = input.keywords?.trim() ?? "";
  let ftsRows: SemanticRow[] = [];
  if (keywords) {
    const tsquery = Prisma.sql`websearch_to_tsquery('bible_simple', ${keywords})`;
    ftsRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
      SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Book" b ON b."id" = v."bookId"
      JOIN "Corpus" c ON c."id" = v."corpusId"
      WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} ${bookFilter} ${chapterFilter}
        AND v."textSearch" @@ ${tsquery}
      ORDER BY ts_rank(v."textSearch", ${tsquery}) DESC
      LIMIT ${POOL}
    `);
  }

  const toRanked = (rows: SemanticRow[]): RankedRef[] =>
    rows.map((r) => ({
      reference: formatReference(r.osisId, r.chapter, r.verse),
      corpus: SEMANTIC_INDEX_CORPUS,
      text: r.text
    }));

  const fused = reciprocalRankFusion([toRanked(vectorRows), toRanked(ftsRows)]);

  // SBL-spine filter: keep only fused refs that exist in SBLGNT.
  const allRows = [...vectorRows, ...ftsRows];
  const spine = await filterToSblSpine(
    allRows.map((r) => ({ book: r.osisId, chapter: r.chapter, verse: r.verse }))
  );
  const byRef = new Map(allRows.map((r) => [formatReference(r.osisId, r.chapter, r.verse), r]));
  const onSpine = fused.filter((f) => {
    const r = byRef.get(f.reference);
    return r ? spine.has(spineKey(r.osisId, r.chapter, r.verse)) : false;
  });

  if (input.rerank === false) {
    return semanticResult(onSpine.slice(0, limit), { status: "disabled", candidateCount: onSpine.length });
  }

  // Top-30 → top-5: rerank only the capped pool; fallback uses the full onSpine.
  const rerankPool = onSpine.slice(0, RERANK_CANDIDATE_LIMIT);
  const reranked = await rerankCandidates({
    query,
    candidates: rerankPool.map((r) => ({ reference: r.reference, text: r.text })),
    topN: limit
  });
  if (!reranked) {
    return semanticResult(onSpine.slice(0, limit), { status: "fallback", candidateCount: rerankPool.length });
  }

  // Map reranked references back to the full RankedRef entries (preserve corpus/text).
  const onSpineByRef = new Map(onSpine.map((r) => [r.reference, r]));
  const results = reranked
    .map((c) => onSpineByRef.get(c.reference))
    .filter((r): r is RankedRef => Boolean(r))
    .slice(0, limit);
  return semanticResult(results, { status: "applied", candidateCount: rerankPool.length });
}

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
        domains: resolveTokenDomains(token.louwNida, token.lnDomain, domainLabels),
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

  const spine = rows.length > 0
    ? await filterToSblSpine(rows.map((row) => ({ book: row.osisId, chapter: row.chapter, verse: row.verse })))
    : new Set<string>();

  return {
    query,
    pagination: paginationResult(pagination, total),
    results: rows.map((row) => ({
      corpus: row.corpus,
      reference: formatReference(row.osisId, row.chapter, row.verse),
      text: row.text,
      onSpine: spine.has(spineKey(row.osisId, row.chapter, row.verse))
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
    // Case-insensitive so capitalized lemma variants in the corpus (e.g. both
    // διάβολος and Διάβολος, or proper-noun lemmas like Σατανᾶς) are matched by a
    // single search term regardless of the casing supplied by the caller/map.
    lemma: { equals: lemma, mode: "insensitive" },
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
  const morphCode = normalizeMorphCodeQuery(input.morphCode.trim());
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

export type DomainFilter =
  | { kind: "ln"; value: string }
  | { kind: "subdomain"; value: string }
  | { kind: "domain"; value: string };

// "33" → "033"; "0033" → "033". Strips non-digits, then takes the rightmost 3 digits
// and left-pads to 3 so hand-authored URLs (e.g. ?domain=0033) still match the canonical
// 3-digit Louw-Nida domain codes. Empty/non-digit input collapses to "000" (matches nothing).
export function normalizeDomainCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-3).padStart(3, "0");
}

// Most-specific filter wins: ln → subdomain → domain.
export function resolveDomainFilter(input: { ln?: string; subdomain?: string; domain?: string }): DomainFilter | null {
  const ln = input.ln?.trim();
  if (ln) return { kind: "ln", value: ln };
  const subdomain = input.subdomain?.trim();
  if (subdomain) return { kind: "subdomain", value: subdomain };
  const domain = input.domain?.trim();
  if (domain) return { kind: "domain", value: normalizeDomainCode(domain) };
  return null;
}

// `domainCodes` is the expanded [domain code + its subdomain codes]; only used for the domain kind.
export function domainTokenWhere(filter: DomainFilter, domainCodes: string[]): Prisma.TokenWhereInput {
  if (filter.kind === "ln") return { louwNida: { has: filter.value } };
  if (filter.kind === "subdomain") return { lnDomain: { has: filter.value } };
  return { lnDomain: { hasSome: domainCodes } };
}

export async function searchDomain(
  input: {
    domain?: string;
    subdomain?: string;
    ln?: string;
    corpus?: "SBLGNT";
    book?: string;
    chapter?: number;
  } & PaginationInput
) {
  const filter = resolveDomainFilter(input);
  const book = normalizeBook(input.book);
  const pagination = normalizePagination(input);
  const empty = {
    filter,
    count: 0,
    results: [] as Awaited<ReturnType<typeof hydrateTokens>>,
    pagination: { ...pagination, total: 0, pageCount: 0 }
  };

  if (!filter) return empty;

  let domainCodes: string[] = [];
  if (filter.kind === "domain") {
    const rows = await prisma.louwNidaDomain.findMany({
      where: { OR: [{ code: filter.value }, { parentCode: filter.value }] },
      select: { code: true }
    });
    domainCodes = rows.map((r) => r.code);
    if (domainCodes.length === 0) return empty;
  }

  const where: Prisma.TokenWhereInput = {
    ...domainTokenWhere(filter, domainCodes),
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

  return { filter, count: total, pagination: paginationResult(pagination, total), results };
}

export type DomainOption = { code: string; number: number; label: string };
export type DomainOptions = {
  domains: DomainOption[];
  subdomainsByDomain: Record<string, { code: string; label: string }[]>;
};

export async function getLouwNidaDomainOptions(): Promise<DomainOptions> {
  const rows = await prisma.louwNidaDomain.findMany({
    where: { level: { in: [1, 2] } },
    select: { code: true, level: true, label: true, parentCode: true }
  });
  const domains = rows
    .filter((r) => r.level === 1)
    .map((r) => ({ code: r.code, number: Number.parseInt(r.code, 10), label: r.label }))
    .sort((a, b) => a.number - b.number);
  const subdomainsByDomain: Record<string, { code: string; label: string }[]> = {};
  for (const r of rows) {
    if (r.level === 2 && r.parentCode) {
      (subdomainsByDomain[r.parentCode] ??= []).push({ code: r.code, label: r.label });
    }
  }
  for (const code of Object.keys(subdomainsByDomain)) {
    subdomainsByDomain[code].sort((a, b) => a.code.localeCompare(b.code));
  }
  return { domains, subdomainsByDomain };
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
