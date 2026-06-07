// eval/thresholds.ts
// Starting values — CALIBRATE against the first real run (Task 11) so the gate
// starts green, then ratchet up. A unit test guards these (exact values after
// calibration). citationResolvability and lemmaCoverage are hard 100% gates.
export const THRESHOLDS = {
  meanRecall: 0.9,
  meanPrecision: 0.8,
  minRecall: 0.5,
  citationResolvability: 1,
  lemmaCoverage: 1
} as const;
