// eval/thresholds.ts
import type { QueryType } from "@/eval/dataset/schema";

// Hard gates applied to EVERY item, regardless of query type. Both are 100%.
export const GLOBAL_GATES = {
  citationResolvability: 1, // every cited reference must resolve to a real SBLGNT verse
  lemmaCoverage: 1 // every item's `mustContainLemma` must appear in the assembled evidence
} as const;

// Per-query-type metric gates. A metric ABSENT from a type's entry is
// REPORT-ONLY: it is still computed and shown in the report, but never fails the
// build. These are calibrated to the achieved DETERMINISTIC baseline — not
// lowered to force every item to pass:
//   - exact-verse / cross-chapter: golden = the exact expected verse set, so
//     deterministic retrieval hits recall AND precision = 1.0 — gate both.
//   - lemma-survey: recall = 1.0 (every golden occurrence is retrieved), but
//     precision is structurally low (golden is a curated subset of all lemma
//     occurrences) — gate recall, report precision.
//   - conceptual: vector-dependent; deterministic recall is low BY DESIGN —
//     report-only here, evaluated in the nightly hybrid report.
//   - domain: report-only until the domain golden sets are validated and scoped
//     against the seeded Louw-Nida data (see calibration follow-ups).
export type TypeGate = { recall?: number; precision?: number };

export const TYPE_GATES: Record<QueryType, TypeGate> = {
  "exact-verse": { recall: 1, precision: 1 },
  "lemma-survey": { recall: 1 },
  "cross-chapter": { recall: 1, precision: 1 },
  conceptual: {},
  domain: {}
};
