// eval/metrics.ts
import { intersectionSize, referenceSet } from "@/eval/references";

export function contextRecall(retrieved: string[], golden: string[]): number {
  const goldenSet = referenceSet(golden);
  if (goldenSet.size === 0) return 1;
  return intersectionSize(referenceSet(retrieved), goldenSet) / goldenSet.size;
}

export function contextPrecision(retrieved: string[], golden: string[]): number {
  const retrievedSet = referenceSet(retrieved);
  if (retrievedSet.size === 0) return referenceSet(golden).size === 0 ? 1 : 0;
  return intersectionSize(retrievedSet, referenceSet(golden)) / retrievedSet.size;
}

export type QuestionScore = {
  recall: number;
  precision: number;
  citationsResolve: boolean;   // every emitted citation resolved to a real verse
  lemmaRequired: boolean;      // item declared a mustContainLemma
  lemmaFound: boolean;         // that lemma appeared in the evidence
};

export type Aggregate = {
  meanRecall: number;
  meanPrecision: number;
  minRecall: number;
  citationResolvability: number; // fraction of questions whose citations all resolved
  lemmaCoverage: number;         // fraction of REQUIRED items whose lemma was found; 1 if none required
  count: number;
};

const mean = (nums: number[]) => (nums.length === 0 ? 1 : nums.reduce((a, b) => a + b, 0) / nums.length);

export function aggregate(scores: QuestionScore[]): Aggregate {
  if (scores.length === 0) {
    return { meanRecall: 1, meanPrecision: 1, minRecall: 1, citationResolvability: 1, lemmaCoverage: 1, count: 0 };
  }
  const required = scores.filter((s) => s.lemmaRequired);
  return {
    meanRecall: mean(scores.map((s) => s.recall)),
    meanPrecision: mean(scores.map((s) => s.precision)),
    minRecall: Math.min(...scores.map((s) => s.recall)),
    citationResolvability: mean(scores.map((s) => (s.citationsResolve ? 1 : 0))),
    lemmaCoverage: required.length === 0 ? 1 : mean(required.map((s) => (s.lemmaFound ? 1 : 0))),
    count: scores.length
  };
}
