import { rerank } from "ai";

export const RERANK_MODEL = process.env.RERANK_MODEL ?? "voyage/rerank-2.5";
const RERANK_TIMEOUT_MS =
  Number(process.env.RERANK_TIMEOUT_MS) > 0 ? Number(process.env.RERANK_TIMEOUT_MS) : 3000;

export type RerankCandidate = { reference: string; text: string };

// Returns the top `topN` candidates reordered by the reranker, or null when
// reranking is unavailable (no AI_GATEWAY_API_KEY) or the call fails/times out.
// On null the caller keeps its existing (RRF) order. Never throws.
//
// The plain RERANK_MODEL string routes through the AI SDK's built-in Vercel AI
// Gateway global provider, authenticated by AI_GATEWAY_API_KEY (no @ai-sdk/gateway).
export async function rerankCandidates(input: {
  query: string;
  candidates: RerankCandidate[];
  topN?: number;
}): Promise<RerankCandidate[] | null> {
  const { query, candidates, topN } = input;
  if (!process.env.AI_GATEWAY_API_KEY || candidates.length === 0) return null;

  try {
    const result = await rerank({
      model: RERANK_MODEL,
      query,
      documents: candidates.map((c) => c.text),
      topN,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(RERANK_TIMEOUT_MS)
    });
    const ranking = result?.ranking;
    if (!Array.isArray(ranking) || ranking.length === 0) return null;

    // A well-behaved reranker returns each candidate index at most once. Treat a
    // non-integer / out-of-range / DUPLICATE index as malformed → null fallback,
    // so a bad response can never produce duplicate verse references downstream.
    const mapped: RerankCandidate[] = [];
    const seen = new Set<number>();
    for (const r of ranking) {
      const originalIndex = r.originalIndex;
      if (
        !Number.isInteger(originalIndex) ||
        originalIndex < 0 ||
        originalIndex >= candidates.length ||
        seen.has(originalIndex)
      ) {
        return null;
      }
      seen.add(originalIndex);
      mapped.push(candidates[originalIndex]);
    }

    const capped = typeof topN === "number" ? mapped.slice(0, topN) : mapped;
    return capped.length > 0 ? capped : null;
  } catch {
    return null;
  }
}
