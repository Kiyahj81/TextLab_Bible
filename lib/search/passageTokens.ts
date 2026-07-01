// lib/search/passageTokens.ts — data types live in the search layer so the AI
// formatter depends on search, not the reverse.
import { prisma } from "@/lib/db";
import { normalizeBook } from "@/lib/references";

export type PassageToken = {
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  domainLabel: string | null;
};
export type PassageTokenRow = PassageToken & { verse: number; wordIndex: number };

// Enriched SBLGNT tokens for a verse range WITHIN A SINGLE CHAPTER — a trimmed
// getReaderPassage token path with no user notes/highlights, for the assistant's
// evidence block. The input intentionally has no chapterEnd: the query filters on one
// `chapter` with `verse BETWEEN verseStart AND verseEnd`, so a cross-chapter span
// (e.g. Rom 7:25–8:4) CANNOT be expressed here — passing one would encode
// `chapter = 7 AND verse BETWEEN 25 AND 4` and silently return []. The only caller
// (passageCall) gates enrichment on `!crossChapter`, so cross-chapter passages are shown
// as base verse text and never reach this helper. If enrichment is ever extended to
// cross-chapter ranges, add chapterEnd support (a per-chapter compound filter) here first.
export async function getPassageTokens(input: {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}): Promise<PassageTokenRow[]> {
  const book = normalizeBook(input.book) ?? input.book;
  const tokens = await prisma.token.findMany({
    where: {
      corpus: { abbreviation: "SBLGNT" },
      book: { osisId: book },
      chapter: input.chapter,
      verse: { gte: input.verseStart, lte: input.verseEnd }
    },
    orderBy: [{ verse: "asc" }, { wordIndex: "asc" }]
  });

  // Resolve the primary Louw-Nida domain code → "Label (NN)", same source as the reader.
  // `lnDomain` is a non-null array (Prisma `@default([])`), so indexing is already safe;
  // the optional-chain is defensive belt-and-suspenders for absent metadata.
  const domainCodes = new Set<string>();
  for (const t of tokens) {
    const primary = t.lnDomain?.[0];
    if (primary) domainCodes.add(primary.slice(0, 3));
  }
  const labelRows = domainCodes.size
    ? await prisma.louwNidaDomain.findMany({
        where: { code: { in: Array.from(domainCodes) } },
        select: { code: true, label: true }
      })
    : [];
  const labels = new Map(labelRows.map((r) => [r.code, r.label]));

  return tokens.map((t) => {
    const code = t.lnDomain?.[0]?.slice(0, 3);
    const label = code ? labels.get(code) : undefined;
    return {
      surface: t.surface,
      lemma: t.lemma,
      morphCode: t.morphCode,
      partOfSpeech: t.partOfSpeech,
      gloss: t.gloss,
      domainLabel: label ? `${label} (${Number.parseInt(code as string, 10)})` : null,
      verse: t.verse,
      wordIndex: t.wordIndex
    };
  });
}
