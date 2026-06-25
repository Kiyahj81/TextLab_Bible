import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";
import { EMBEDDING_MODEL, SEMANTIC_INDEX_CORPUS, formatVectorLiteral } from "@/lib/search/semanticIndex";
import { rerankCandidates } from "@/lib/search/rerank";
import { normalizeMorphCodeQuery } from "@/lib/morphology";
import {
  spineKey, filterToSblSpine, normalizePagination, paginationResult, hydrateTokens,
  type PaginationInput, type HydratedToken
} from "@/lib/search/shared";

export {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "@/lib/search/semanticIndex";

export { spineKey, filterToSblSpine } from "@/lib/search/shared";
export type { SearchPagination, Citation } from "@/lib/search/shared";
export * from "@/lib/search/reader";
export * from "@/lib/search/keyword";

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
// natural-language prompt); `keywords` drives the FTS half (distilled topic words,
// not the full prompt, whose many content words would AND to nothing). The FTS half
// uses the bible_english config (English stemming, consistent with searchKeyword).
// Returns [] when no OpenAI client (embedQuery null).
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
    const tsquery = Prisma.sql`websearch_to_tsquery('bible_english', ${keywords})`;
    ftsRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
      SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Book" b ON b."id" = v."bookId"
      JOIN "Corpus" c ON c."id" = v."corpusId"
      WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} ${bookFilter} ${chapterFilter}
        AND v."textSearchEn" @@ ${tsquery}
      ORDER BY ts_rank(v."textSearchEn", ${tsquery}) DESC
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
    withEnglish?: boolean;
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

  const results = await hydrateTokens(tokens, input.withEnglish);

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

