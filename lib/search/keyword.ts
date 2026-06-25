import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";
import { parseHeadlineSegments, HEADLINE_OPTIONS } from "@/lib/search-highlight";
import {
  spineKey, filterToSblSpine, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";

export async function searchKeyword(input: {
  corpus?: string;
  query: string;
  book?: string;
  chapter?: number;
  orderBy?: "canonical" | "rank";
  withEnglish?: boolean;
} & PaginationInput) {
  const book = normalizeBook(input.book);
  const query = input.query.trim();
  const pagination = normalizePagination(input);

  if (!query) {
    return { query, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  // Each row matches under its own language config: English (WEB) rows are
  // stemmed via bible_english; Greek rows keep whole-lexeme bible_simple.
  // websearch_to_tsquery never throws on arbitrary user/assistant input (stray
  // punctuation, quotes, -exclusion all tolerated); all values bound as
  // parameters — no string interpolation into SQL.
  const enQuery = Prisma.sql`websearch_to_tsquery('bible_english', ${query})`;
  const grQuery = Prisma.sql`websearch_to_tsquery('bible_simple', ${query})`;

  const matchSql = Prisma.sql`(
    (c."language" = 'English' AND v."textSearchEn" @@ ${enQuery})
    OR
    (c."language" <> 'English' AND v."textSearch" @@ ${grQuery})
  )`;

  // Corpus filter mirrors the prior Prisma behavior: explicit corpus, else any
  // corpus except NET.
  const corpusFilter = input.corpus
    ? Prisma.sql`c."abbreviation" = ${input.corpus}`
    : Prisma.sql`c."abbreviation" <> 'NET'`;

  const filters: Prisma.Sql[] = [matchSql, corpusFilter];
  if (book) filters.push(Prisma.sql`b."osisId" = ${book}`);
  if (input.chapter !== undefined) filters.push(Prisma.sql`v."chapter" = ${input.chapter}`);
  const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

  // Rank by whichever column/config matched the row. In rank mode the per-config
  // tsquery is embedded again (the @@ filter and ts_rank), so Postgres evaluates
  // websearch_to_tsquery once per use — negligible at NT-corpus scale. If profiling
  // ever shows overhead, compute the tsqueries once in a CTE.
  const rankSql = Prisma.sql`(CASE WHEN c."language" = 'English'
    THEN ts_rank(v."textSearchEn", ${enQuery})
    ELSE ts_rank(v."textSearch", ${grQuery}) END)`;
  const orderSql =
    input.orderBy === "rank"
      ? Prisma.sql`ORDER BY ${rankSql} DESC, b."order" ASC, v."chapter" ASC, v."verse" ASC`
      : Prisma.sql`ORDER BY b."order" ASC, v."chapter" ASC, v."verse" ASC`;

  // Per-row stem-aware highlight markup, same config that matched the row.
  // HighlightAll=TRUE returns the whole verse (not a snippet); sentinels are
  // parsed back into HighlightSegment[] by parseHeadlineSegments.
  const headlineSql = Prisma.sql`CASE WHEN c."language" = 'English'
    THEN ts_headline('bible_english', v."text", ${enQuery}, ${HEADLINE_OPTIONS})
    ELSE ts_headline('bible_simple', v."text", ${grQuery}, ${HEADLINE_OPTIONS}) END`;

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
      { corpus: string; osisId: string; chapter: number; verse: number; text: string; headline: string }[]
    >(Prisma.sql`
      SELECT c."abbreviation" AS corpus, b."osisId" AS "osisId",
             v."chapter" AS chapter, v."verse" AS verse, v."text" AS text,
             ${headlineSql} AS headline
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

  // When withEnglish is true, batch-fetch WEB verse text for the SBLGNT rows only
  // (WEB rows are already English — skip them). One extra query; absent when flag is off.
  const webEnglishMap = new Map<string, string>();
  if (input.withEnglish) {
    const sblgntRows = rows.filter((r) => r.corpus === "SBLGNT");
    if (sblgntRows.length > 0) {
      const webVerses = await prisma.verse.findMany({
        where: {
          corpus: { abbreviation: "WEB" },
          OR: sblgntRows.map((r) => ({ book: { osisId: r.osisId }, chapter: r.chapter, verse: r.verse }))
        },
        select: { chapter: true, verse: true, text: true, book: { select: { osisId: true } } }
      });
      for (const v of webVerses) {
        webEnglishMap.set(spineKey(v.book.osisId, v.chapter, v.verse), v.text);
      }
    }
  }

  return {
    query,
    pagination: paginationResult(pagination, total),
    results: rows.map((row) => ({
      corpus: row.corpus,
      reference: formatReference(row.osisId, row.chapter, row.verse),
      text: row.text,
      onSpine: spine.has(spineKey(row.osisId, row.chapter, row.verse)),
      highlightSegments: parseHeadlineSegments(row.headline),
      ...(input.withEnglish && row.corpus === "SBLGNT"
        ? { englishText: webEnglishMap.get(spineKey(row.osisId, row.chapter, row.verse)) }
        : {})
    }))
  };
}
