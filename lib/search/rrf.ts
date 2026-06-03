export type RankedRef = { reference: string; corpus: string; text: string };

// Reciprocal Rank Fusion. Each input list is in descending relevance order.
// Fused score for a reference = Σ over lists of 1/(k + rank0), rank0 0-based.
// Deduped by reference; the first-seen item supplies the kept corpus/text.
export function reciprocalRankFusion(lists: RankedRef[][], k = 60): RankedRef[] {
  const scores = new Map<string, number>();
  const meta = new Map<string, RankedRef>();
  for (const list of lists) {
    list.forEach((item, rank0) => {
      scores.set(item.reference, (scores.get(item.reference) ?? 0) + 1 / (k + rank0));
      if (!meta.has(item.reference)) meta.set(item.reference, item);
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reference]) => meta.get(reference)!);
}
