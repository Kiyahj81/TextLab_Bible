import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";
import { EMBEDDING_MODEL, SEMANTIC_INDEX_CORPUS, formatVectorLiteral } from "@/lib/search/semanticIndex";
import { rerankCandidates } from "@/lib/search/rerank";
import { spineKey, filterToSblSpine } from "@/lib/search/shared";

export {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "@/lib/search/semanticIndex";

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
