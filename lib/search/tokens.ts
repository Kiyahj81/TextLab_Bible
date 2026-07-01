import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeBook } from "@/lib/references";
import { normalizeMorphCodeQuery } from "@/lib/morphology";
import {
  hydrateTokens, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";

export async function searchLemma(input: {
  lemma: string;
  corpus?: "SBLGNT";
  book?: string;
  chapter?: number;
  withEnglish?: boolean;
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

  // `gloss` is a scalar column returned by default; surfaced via hydrateTokens for evidence.
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

  const results = await hydrateTokens(tokens, input.withEnglish);

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
  withEnglish?: boolean;
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

  const results = await hydrateTokens(tokens, input.withEnglish);

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
