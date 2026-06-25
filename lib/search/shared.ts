import { prisma } from "@/lib/db";
import { formatReference } from "@/lib/references";

export type PaginationInput = {
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

export function normalizePagination(input: PaginationInput) {
  // Math.max(1, ...) AFTER the floor: a fractional value in (0, 1) passes the
  // `> 0` check but floors to 0, which would make paginationResult's pageCount
  // Infinity and drive LIMIT 0 queries. Clamp the floored result up to 1.
  const page =
    Number.isFinite(input.page) && input.page && input.page > 0 ? Math.max(1, Math.floor(input.page)) : 1;
  const requestedPageSize =
    Number.isFinite(input.pageSize) && input.pageSize && input.pageSize > 0
      ? Math.max(1, Math.floor(input.pageSize))
      : 25;

  return {
    page,
    pageSize: Math.min(requestedPageSize, 100)
  };
}

export function paginationResult(pagination: { page: number; pageSize: number }, total: number): SearchPagination {
  return {
    ...pagination,
    total,
    pageCount: Math.ceil(total / pagination.pageSize)
  };
}

export type HydratedToken = {
  id: string;
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  chapter: number;
  verse: number;
  book: { id: string; osisId: string };
  corpus: { abbreviation: string };
};

export async function hydrateTokens(tokens: HydratedToken[], withEnglish = false) {
  if (tokens.length === 0) return [];

  const bookIds = Array.from(new Set(tokens.map((t) => t.book.id)));
  const corpora = Array.from(new Set(tokens.map((t) => t.corpus.abbreviation)));
  // When withEnglish is true, include WEB in the corpus list so the existing
  // verse.findMany fetches both Greek and English rows in one query.
  const corporaToFetch = withEnglish && !corpora.includes("WEB") ? [...corpora, "WEB"] : corpora;

  const verses = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: { in: corporaToFetch } },
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
    verseText: verseText.get(key(token.book.id, token.chapter, token.verse, token.corpus.abbreviation)) ?? "",
    ...(withEnglish
      ? { englishText: verseText.get(key(token.book.id, token.chapter, token.verse, "WEB")) }
      : {})
  }));
}
