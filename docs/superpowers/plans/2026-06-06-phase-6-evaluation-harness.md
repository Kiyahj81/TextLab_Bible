# Phase 6 — Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `eval/` harness with two tiers: a deterministic, free, blocking PR gate (Context Precision/Recall + required lemma/domain coverage + citation resolvability over the deterministic retrieval paths) and a non-blocking nightly hybrid quality report (full live pipeline + LLM-as-judge faithfulness via the Vercel AI Gateway).

**Architecture:** A leaf `eval/` module imports from `lib/ai/*` and `lib/search.ts` but is imported by nothing in `app/`/`lib/`, so it cannot affect runtime. A shared runner runs each golden question through the pipeline and produces a `RunResult` from **exactly one `EvidencePacket`**. The gate uses `runRetrievalPlan(…, semanticEnabled=false)` (deterministic, DB-only). The report uses `semanticEnabled=true`, then builds the judged answer from that **same** packet via `synthesizeWithRefinement` and judges faithfulness via the AI Gateway.

**Tech Stack:** TypeScript, tsx (script runner), Vitest 4 (unit/integration), zod 3 (dataset + judge schema), Prisma 6 over the Neon test branch (`.env.test`), the `ai` SDK (already a dependency) for the gateway-routed judge. No new dependencies.

---

## Why two tiers (read before implementing — it determines the whole shape)

A key-free deterministic gate **cannot** exercise the hybrid vector pipeline or detect generative hallucination in this codebase:

- `runRetrievalPlan(signals, prompt, semanticEnabled=false)` skips the semantic call (`lib/ai/retrievalPlanner.ts:551`).
- `embedQuery` returns `null` without an OpenAI client (`lib/search.ts:65-68`) → no vector KNN without a key.
- `rerankCandidates` returns `null` without `AI_GATEWAY_API_KEY` (`lib/search/rerank.ts:21`) → no rerank without a key.
- The deterministic fallback answer embeds evidence **verbatim** (`buildDeterministicFallback`), so it cannot produce a citation-shaped hallucination — there is no generative prose to check.

Therefore: **gate = deterministic evidence-retrieval + citation-safety regression gate; report = full hybrid-pipeline quality + faithfulness.** Do not make the gate claim to test hybrid retrieval or catch hallucinations.

## Key facts the implementer must know (verified against the codebase)

- **Reference format is `<osisId> <chapter>:<verse>`** — `1Cor 13:1`, `John 3:16`. `formatReference(osisId, chapter, verse)` (`lib/references.ts:1`); `parseReference(input)` (`lib/references.ts:50`) returns `{ book, chapter, verse, verseEnd? } | null`, normalizing aliases. osisIds: `Matt, Mark, Luke, John, Acts, Rom, 1Cor, 2Cor, Gal, Eph, Phil, Col, 1Thess, 2Thess, 1Tim, 2Tim, Titus, Phlm, Heb, Jas, 1Pet, 2Pet, 1John, 2John, 3John, Jude, Rev`.
- **Pipeline entry points** (all exist):
  - `extractSignals(prompt: string): Signals` — `lib/ai/signals.ts:394`.
  - `runRetrievalPlan(signals, prompt = "", semanticEnabled = true): Promise<EvidencePacket>` — `lib/ai/retrievalPlanner.ts:563`. `EvidencePacket = { citations: AssistantCitation[]; toolTrace: ToolTraceEntry[]; formattedEvidence: string }`.
  - `AssistantCitation = { reference: string; corpus: string; searchQuery: string; toolName?: string; book?; chapter?; verse?; tokenId? }` — `lib/ai/assistant.ts:23`. `reference` is the canonical string.
  - `verifyGrounding(claims: GroundingClaim[]): Promise<GroundingReport>` — `lib/ai/grounding.ts:72`. `GroundingClaim = { reference: string; greekQuote: string | null; gloss: string | null; englishQuote: string | null }`. `GroundingReport = { grounded: boolean; verdicts: ClaimVerdict[] }`. **With `greekQuote: null` it verifies reference resolution only** (`grounding.ts:106` gates quote-matching on `if (claim.greekQuote)`) — this is exactly the "citation resolvability" semantics the gate wants.
  - `synthesizeWithRefinement(input: { prompt: string; evidence: EvidencePacket; routing: RoutingDecision }): Promise<{ answer: string; claims; citations; toolTrace } | null>` — `lib/ai/synthesis.ts:197`. Returns `null` with no OpenAI client. **Use this to build the report's answer from the same packet the metrics came from** (do not call `answerBibleQuestion`, which re-retrieves).
  - `routeAssistantPrompt(prompt: string, escalate: boolean): RoutingDecision` — `@/lib/ai/modelRouter` (used at `assistant.ts:53`).
- **Gateway-routed model strings:** `lib/search/rerank.ts` calls the `ai` SDK's `rerank({ model: "voyage/rerank-2.5" })` — a bare `creator/model` slug routed through the AI SDK's built-in Vercel AI Gateway global provider, authenticated by `AI_GATEWAY_API_KEY` (no `@ai-sdk/gateway` import). The judge uses `generateObject({ model: "anthropic/claude-sonnet-4-6", … })` the same way.
- **Scripts run via `tsx --env-file=<file>`** (`package.json:22-25`). `.env.test` points `DATABASE_URL`/`DIRECT_URL` at the seeded Neon test branch.
- **Editorial-scholar palette** (`app/globals.css:5-13`): `--background:#f6f5f1; --foreground:#1f2933; --surface:#ffffff; --muted:#6b7280; --border:#d7d3ca; --accent:#365f7e;`. Display serif Spectral; UI sans Inter Tight; Greek Gentium Plus.
- **Integration-test convention:** `tests/integration/`, via `vitest.integration.config.ts`, **skip when `DATABASE_URL` is unset**.

## File structure

| Path | Responsibility |
|---|---|
| `eval/dataset/schema.ts` | zod schema + types for a golden item; `QUERY_TYPES` |
| `eval/dataset/golden-set.json` | ~20 curated questions with golden references (committed) |
| `eval/thresholds.ts` | Gate threshold constants (single source of truth) |
| `eval/references.ts` | `canonicalizeReference` + set-comparison helpers |
| `eval/metrics.ts` | `contextPrecision`, `contextRecall`, `aggregate` (recall/precision/coverage/resolvability) |
| `eval/judge.ts` | `judgeFaithfulness` via AI Gateway (`generateObject`, key-gated) |
| `eval/runner.ts` | `runDeterministic` / `runWithJudge` → `RunResult` (one packet each) |
| `eval/report.ts` | `renderHtmlReport` + `renderJsonReport` |
| `eval/output/` | gitignored: `report.html`, `report.json` |
| `scripts/eval-gate.ts` | `npm run eval:gate` — deterministic, exit code |
| `scripts/eval-report.ts` | `npm run eval:report` — full hybrid run + HTML/JSON |
| `tests/unit/eval/*.test.ts` | references, metrics, dataset, thresholds, report |
| `tests/integration/eval-runner.test.ts` | one question end-to-end against the test DB |

---

## Task 1: Dataset schema and types

**Files:** Create `eval/dataset/schema.ts`

- [ ] **Step 1: Write the schema module**

```typescript
// eval/dataset/schema.ts
import { z } from "zod";

export const QUERY_TYPES = [
  "exact-verse",
  "lemma-survey",
  "conceptual",
  "domain",
  "cross-chapter"
] as const;

export type QueryType = (typeof QUERY_TYPES)[number];

export const goldenItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  queryType: z.enum(QUERY_TYPES),
  goldenReferences: z.array(z.string().min(1)).min(1),
  mustContainLemma: z.string().min(1).optional(),
  notes: z.string().optional()
});

export const goldenSetSchema = z.array(goldenItemSchema).min(1);
export type GoldenItem = z.infer<typeof goldenItemSchema>;
```

- [ ] **Step 2: Verify it type-checks** — Run: `npx tsc --noEmit --pretty false` → PASS.

- [ ] **Step 3: Commit**

```bash
git add eval/dataset/schema.ts
git commit -m "Add golden-set schema and query-type constants for eval harness"
```

---

## Task 2: Reference canonicalization helpers

**Files:** Create `eval/references.ts`; Test `tests/unit/eval/references.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eval/references.test.ts
import { describe, expect, it } from "vitest";
import { canonicalizeReference, referenceSet, intersectionSize } from "@/eval/references";

describe("canonicalizeReference", () => {
  it("normalizes alias + spacing to canonical osisId form", () => {
    expect(canonicalizeReference("1 Corinthians 13:1")).toBe("1Cor 13:1");
    expect(canonicalizeReference("1cor 13:1")).toBe("1Cor 13:1");
    expect(canonicalizeReference("John 3:16")).toBe("John 3:16");
  });
  it("returns null for unparseable input", () => {
    expect(canonicalizeReference("not a reference")).toBeNull();
  });
});

describe("referenceSet / intersectionSize", () => {
  it("dedupes and intersects canonically", () => {
    const a = referenceSet(["1 Corinthians 13:1", "1cor 13:1", "John 3:16"]);
    const b = referenceSet(["1Cor 13:1"]);
    expect(a.size).toBe(2);
    expect(intersectionSize(a, b)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/eval/references.test.ts` → FAIL (cannot resolve module).

- [ ] **Step 3: Write the implementation**

```typescript
// eval/references.ts
import { formatReference, parseReference } from "@/lib/references";

export function canonicalizeReference(input: string): string | null {
  const parsed = parseReference(input);
  if (!parsed) return null;
  return formatReference(parsed.book, parsed.chapter, parsed.verse);
}

export function referenceSet(refs: string[]): Set<string> {
  const set = new Set<string>();
  for (const ref of refs) {
    const canonical = canonicalizeReference(ref);
    if (canonical) set.add(canonical);
  }
  return set;
}

export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/eval/references.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/references.ts tests/unit/eval/references.test.ts
git commit -m "Add canonical reference helpers for eval metrics"
```

---

## Task 3: Metrics (precision / recall / aggregation)

**Files:** Create `eval/metrics.ts`; Test `tests/unit/eval/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eval/metrics.test.ts
import { describe, expect, it } from "vitest";
import { contextPrecision, contextRecall, aggregate } from "@/eval/metrics";

describe("contextRecall", () => {
  it("is the fraction of golden refs retrieved", () => {
    expect(contextRecall(["1Cor 13:1", "1Cor 13:2"], ["1Cor 13:1"])).toBe(0.5);
  });
  it("is 1 when golden is empty", () => {
    expect(contextRecall([], ["John 3:16"])).toBe(1);
  });
  it("normalizes aliases before comparing", () => {
    expect(contextRecall(["1 Corinthians 13:1"], ["1cor 13:1"])).toBe(1);
  });
});

describe("contextPrecision", () => {
  it("is the fraction of retrieved refs that are golden", () => {
    expect(contextPrecision(["1Cor 13:1", "Rom 1:1"], ["1Cor 13:1"])).toBe(0.5);
  });
  it("is 1 when both empty, 0 when golden non-empty but nothing retrieved", () => {
    expect(contextPrecision([], [])).toBe(1);
    expect(contextPrecision([], ["John 3:16"])).toBe(0);
  });
});

describe("aggregate", () => {
  it("computes means, recall floor, resolvability, and coverage", () => {
    const agg = aggregate([
      { recall: 1, precision: 1, citationsResolve: true, lemmaRequired: true, lemmaFound: true },
      { recall: 0.4, precision: 0.8, citationsResolve: true, lemmaRequired: false, lemmaFound: false }
    ]);
    expect(agg.meanRecall).toBeCloseTo(0.7);
    expect(agg.meanPrecision).toBeCloseTo(0.9);
    expect(agg.minRecall).toBe(0.4);
    expect(agg.citationResolvability).toBe(1);
    expect(agg.lemmaCoverage).toBe(1); // only the 1 required item, which was found
  });
  it("lemmaCoverage is 1 when no item requires a lemma, and drops when a required lemma is missing", () => {
    expect(aggregate([{ recall: 1, precision: 1, citationsResolve: true, lemmaRequired: false, lemmaFound: false }]).lemmaCoverage).toBe(1);
    expect(aggregate([{ recall: 1, precision: 1, citationsResolve: true, lemmaRequired: true, lemmaFound: false }]).lemmaCoverage).toBe(0);
  });
  it("citationResolvability drops when any citation fails to resolve", () => {
    expect(aggregate([
      { recall: 1, precision: 1, citationsResolve: true, lemmaRequired: false, lemmaFound: false },
      { recall: 1, precision: 1, citationsResolve: false, lemmaRequired: false, lemmaFound: false }
    ]).citationResolvability).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/eval/metrics.test.ts` → FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/eval/metrics.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/metrics.ts tests/unit/eval/metrics.test.ts
git commit -m "Add precision/recall + resolvability/coverage aggregation for eval harness"
```

---

## Task 4: Threshold constants

**Files:** Create `eval/thresholds.ts`; Test `tests/unit/eval/thresholds.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eval/thresholds.test.ts
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "@/eval/thresholds";

describe("THRESHOLDS", () => {
  it("are all within [0,1]", () => {
    for (const value of Object.values(THRESHOLDS)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
  it("keeps the per-question recall floor at or below the mean-recall gate", () => {
    expect(THRESHOLDS.minRecall).toBeLessThanOrEqual(THRESHOLDS.meanRecall);
  });
  it("requires perfect citation resolvability and lemma coverage", () => {
    expect(THRESHOLDS.citationResolvability).toBe(1);
    expect(THRESHOLDS.lemmaCoverage).toBe(1);
  });
  // NOTE (Finding 6): after calibration (Task 11), tighten this suite to assert
  // the EXACT calibrated meanRecall / meanPrecision / minRecall values, so an
  // accidental threshold edit is caught — not just out-of-bounds values.
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/eval/thresholds.test.ts` → FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/eval/thresholds.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/thresholds.ts tests/unit/eval/thresholds.test.ts
git commit -m "Add eval gate thresholds with sanity-bound test"
```

---

## Task 5: Curated golden dataset + validation test

**Files:** Create `eval/dataset/golden-set.json`; Test `tests/unit/eval/dataset.test.ts`

> **Maintainer review checkpoint:** the question set below is a STARTING draft. Submit to the maintainer for review before calibrating thresholds (Task 11). Every `queryType` must appear ≥ 1. Golden references must be real NT verses in canonical `<osisId> <chapter>:<verse>` form. Domain items are flagged "VERIFY against seeded data" — confirm the exact verse set during review/calibration.

- [ ] **Step 1: Write the dataset (≈20 items spanning all five query types)**

```json
[
  { "id": "john-3-16-exact", "question": "What does John 3:16 say?", "queryType": "exact-verse", "goldenReferences": ["John 3:16"], "notes": "Single exact-verse lookup." },
  { "id": "rom-8-28-exact", "question": "Explain Romans 8:28.", "queryType": "exact-verse", "goldenReferences": ["Rom 8:28"], "notes": "Exact-verse; precision on a pinpointed prompt." },
  { "id": "matt-6-9-exact", "question": "What is written in Matthew 6:9?", "queryType": "exact-verse", "goldenReferences": ["Matt 6:9"], "notes": "Exact-verse lookup." },
  { "id": "faith-hope-love-exact", "question": "What does 1 Corinthians 13:13 say about faith, hope, and love?", "queryType": "exact-verse", "goldenReferences": ["1Cor 13:13"], "notes": "Exact-verse with topical phrasing; should still pin to one verse." },
  { "id": "agape-1cor13-lemma", "question": "Where does the Greek word ἀγάπη appear in 1 Corinthians 13?", "queryType": "lemma-survey", "goldenReferences": ["1Cor 13:1", "1Cor 13:2", "1Cor 13:3", "1Cor 13:4", "1Cor 13:8", "1Cor 13:13"], "mustContainLemma": "ἀγάπη", "notes": "Lemma survey scoped to one chapter." },
  { "id": "pistis-rom4-lemma", "question": "Occurrences of the lemma πίστις in Romans 4.", "queryType": "lemma-survey", "goldenReferences": ["Rom 4:5", "Rom 4:9", "Rom 4:11", "Rom 4:12", "Rom 4:13", "Rom 4:14", "Rom 4:16", "Rom 4:19", "Rom 4:20"], "mustContainLemma": "πίστις", "notes": "Lemma survey in a single chapter." },
  { "id": "logos-john1-lemma", "question": "Where does λόγος appear in John 1?", "queryType": "lemma-survey", "goldenReferences": ["John 1:1", "John 1:14"], "mustContainLemma": "λόγος", "notes": "Famous prologue occurrences." },
  { "id": "charis-eph2-lemma", "question": "Find the word χάρις in Ephesians 2.", "queryType": "lemma-survey", "goldenReferences": ["Eph 2:5", "Eph 2:7", "Eph 2:8"], "mustContainLemma": "χάρις", "notes": "Lemma survey scoped to one chapter." },
  { "id": "reconciliation-conceptual", "question": "What does the New Testament teach about reconciliation with God?", "queryType": "conceptual", "goldenReferences": ["Rom 5:10", "Rom 5:11", "2Cor 5:18", "2Cor 5:19", "2Cor 5:20", "Col 1:20", "Col 1:21", "Col 1:22"], "notes": "Conceptual; hybrid path in the nightly report. In the gate, recall reflects deterministic keyword matching only." },
  { "id": "justification-faith-conceptual", "question": "How is a person justified by faith?", "queryType": "conceptual", "goldenReferences": ["Rom 3:28", "Rom 5:1", "Gal 2:16", "Gal 3:24", "Eph 2:8", "Eph 2:9"], "notes": "Conceptual; cross-book." },
  { "id": "fruit-of-spirit-conceptual", "question": "What is the fruit of the Spirit?", "queryType": "conceptual", "goldenReferences": ["Gal 5:22", "Gal 5:23"], "notes": "Tightly localized concept; precision check." },
  { "id": "love-neighbor-conceptual", "question": "What does Jesus teach about loving your neighbor?", "queryType": "conceptual", "goldenReferences": ["Matt 22:39", "Mark 12:31", "Luke 10:27", "Rom 13:9", "Gal 5:14"], "notes": "Conceptual; cross-book teaching theme." },
  { "id": "sexual-immorality-conceptual", "question": "What does Paul say about sexual immorality?", "queryType": "conceptual", "goldenReferences": ["1Cor 6:18", "1Thess 4:3", "Gal 5:19", "Eph 5:3"], "notes": "Phrase-term conceptual prompt." },
  { "id": "resurrection-1cor15-conceptual", "question": "What does Paul argue about the resurrection of the dead?", "queryType": "conceptual", "goldenReferences": ["1Cor 15:12", "1Cor 15:13", "1Cor 15:14", "1Cor 15:20", "1Cor 15:21", "1Cor 15:22"], "notes": "Conceptual; should concentrate in 1 Cor 15." },
  { "id": "domain-33-communication", "question": "Show me words in Louw-Nida domain 33 in James 3.", "queryType": "domain", "goldenReferences": ["Jas 3:2", "Jas 3:5", "Jas 3:6", "Jas 3:8", "Jas 3:9", "Jas 3:10"], "notes": "Domain mode; 'domain 33' (Communication) → domainCall, scoped to one chapter. VERIFY exact verse set against seeded data." },
  { "id": "domain-ln-25-love", "question": "Find Louw-Nida 25.43 occurrences in 1 John 4.", "queryType": "domain", "goldenReferences": ["1John 4:7", "1John 4:8", "1John 4:10", "1John 4:11", "1John 4:12", "1John 4:16", "1John 4:19", "1John 4:20", "1John 4:21"], "notes": "Domain mode; explicit LN reference (25.43, 'to love') → domainCall. VERIFY exact verse set against seeded data." },
  { "id": "domain-88-moral-rom1", "question": "Words in domain 88 in Romans 1.", "queryType": "domain", "goldenReferences": ["Rom 1:29", "Rom 1:30", "Rom 1:31"], "notes": "Domain mode (Moral/Ethical qualities). VERIFY against seeded data." },
  { "id": "beatitudes-cross-chapter", "question": "Walk through the Sermon on the Mount from Matthew 5:1 to 5:12.", "queryType": "cross-chapter", "goldenReferences": ["Matt 5:1", "Matt 5:2", "Matt 5:3", "Matt 5:4", "Matt 5:5", "Matt 5:6", "Matt 5:7", "Matt 5:8", "Matt 5:9", "Matt 5:10", "Matt 5:11", "Matt 5:12"], "notes": "In-chapter range; passageCall range assembly." },
  { "id": "earthen-vessels-cross-chapter", "question": "Discuss 2 Corinthians 4:16 through 5:10.", "queryType": "cross-chapter", "goldenReferences": ["2Cor 4:16", "2Cor 4:17", "2Cor 4:18", "2Cor 5:1", "2Cor 5:2", "2Cor 5:3", "2Cor 5:4", "2Cor 5:5", "2Cor 5:6", "2Cor 5:7", "2Cor 5:8", "2Cor 5:9", "2Cor 5:10"], "notes": "True cross-chapter range (chapterEnd); per-chapter getPassage fan-out." },
  { "id": "armor-of-god-cross-chapter", "question": "Explain the armor of God in Ephesians 6:10-18.", "queryType": "cross-chapter", "goldenReferences": ["Eph 6:10", "Eph 6:11", "Eph 6:12", "Eph 6:13", "Eph 6:14", "Eph 6:15", "Eph 6:16", "Eph 6:17", "Eph 6:18"], "notes": "In-chapter range." }
]
```

- [ ] **Step 2: Write the validation test**

```typescript
// tests/unit/eval/dataset.test.ts
import { describe, expect, it } from "vitest";
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema, QUERY_TYPES } from "@/eval/dataset/schema";
import { canonicalizeReference } from "@/eval/references";

describe("golden-set.json", () => {
  const parsed = goldenSetSchema.parse(goldenSet);

  it("validates against the schema", () => {
    expect(parsed.length).toBeGreaterThanOrEqual(15);
  });
  it("has unique ids", () => {
    const ids = parsed.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers every query type at least once", () => {
    const present = new Set(parsed.map((item) => item.queryType));
    for (const type of QUERY_TYPES) expect(present).toContain(type);
  });
  it("uses only parseable canonical references", () => {
    for (const item of parsed) {
      for (const ref of item.goldenReferences) {
        expect(canonicalizeReference(ref), `${item.id}: ${ref}`).not.toBeNull();
      }
    }
  });
});
```

- [ ] **Step 3: Run the test** — Run: `npx vitest run tests/unit/eval/dataset.test.ts` → PASS. If a reference fails to parse, fix the osisId spelling. (JSON import requires `resolveJsonModule`, already enabled in Next.js `tsconfig.json`.)

- [ ] **Step 4: Commit**

```bash
git add eval/dataset/golden-set.json tests/unit/eval/dataset.test.ts
git commit -m "Add curated NT-exegesis golden set + validation test (draft for review)"
```

---

## Task 6: LLM-as-judge faithfulness via the Vercel AI Gateway

**Files:** Create `eval/judge.ts`

> The judge runs only in the nightly/on-demand report, never in the gate. It is **key-gated on `AI_GATEWAY_API_KEY`**: with no key it returns `null` (skipped), and any error/timeout also returns `null` — it must never throw or block. Routed through the AI SDK's gateway global provider exactly like `lib/search/rerank.ts`.

- [ ] **Step 1: Confirm the `ai` SDK surface**

Open `lib/search/rerank.ts` and confirm the import style (`import { rerank } from "ai"`) and the bare `creator/model` slug usage with `AI_GATEWAY_API_KEY`. The judge mirrors this with `generateObject`. If `generateObject` is not exported by the installed `ai` version, check the installed version's exports (`node -e "console.log(Object.keys(require('ai')))"`) and use whatever object-generation helper it provides (`generateObject` is standard in AI SDK v5/v6 — `package.json` pins `ai@^6`).

- [ ] **Step 2: Write the implementation**

```typescript
// eval/judge.ts
import { generateObject } from "ai";
import { z } from "zod";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

// Bare creator/model slug routed through the AI SDK's Vercel AI Gateway global
// provider (authenticated by AI_GATEWAY_API_KEY) — same mechanism as rerank.ts.
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-4-6";

const claimSchema = z.object({
  statement: z.string(),
  supported: z.boolean(),
  reason: z.string()
});
const faithfulnessSchema = z.object({ claims: z.array(claimSchema) });

export type FaithfulnessClaim = z.infer<typeof claimSchema>;
export type FaithfulnessResult = { score: number; claims: FaithfulnessClaim[]; model: string };

const JUDGE_SYSTEM =
  "You are a strict faithfulness judge for a Bible-study assistant. Given an " +
  "ANSWER and the EVIDENCE it was built from, break the answer into atomic " +
  "factual statements. For each, decide whether it is directly supported by the " +
  "EVIDENCE alone. Do not use outside knowledge. SBLGNT Greek is the citation " +
  "authority; the WEB English is a display aid only.";

// Returns null when no AI_GATEWAY_API_KEY is set, or on any error/timeout
// (nightly-only signal; must never block or throw the report).
export async function judgeFaithfulness(
  answer: string,
  evidence: EvidencePacket
): Promise<FaithfulnessResult | null> {
  if (!process.env.AI_GATEWAY_API_KEY) return null;
  try {
    const { object } = await generateObject({
      model: EVAL_JUDGE_MODEL,
      schema: faithfulnessSchema,
      system: JUDGE_SYSTEM,
      prompt: `EVIDENCE:\n${evidence.formattedEvidence}\n\nANSWER:\n${answer}`
    });
    const claims = object.claims ?? [];
    const supported = claims.filter((c) => c.supported).length;
    const score = claims.length === 0 ? 1 : supported / claims.length;
    return { score, claims, model: EVAL_JUDGE_MODEL };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify it type-checks** — Run: `npx tsc --noEmit --pretty false` → PASS.

- [ ] **Step 4: Commit**

```bash
git add eval/judge.ts
git commit -m "Add gateway-routed LLM-as-judge faithfulness scorer (nightly-only, key-gated)"
```

---

## Task 7: Runner (one EvidencePacket per mode)

**Files:** Create `eval/runner.ts`

> **Finding 3 fix:** each mode runs retrieval **once** and derives everything from that single packet. Report mode builds the judged answer from the same packet via `synthesizeWithRefinement` — it does NOT call `answerBibleQuestion` (which re-retrieves).

- [ ] **Step 1: Write the implementation**

```typescript
// eval/runner.ts
import { extractSignals } from "@/lib/ai/signals";
import { runRetrievalPlan, type EvidencePacket } from "@/lib/ai/retrievalPlanner";
import { verifyGrounding } from "@/lib/ai/grounding";
import { synthesizeWithRefinement } from "@/lib/ai/synthesis";
import { routeAssistantPrompt } from "@/lib/ai/modelRouter";
import { contextPrecision, contextRecall } from "@/eval/metrics";
import { judgeFaithfulness, type FaithfulnessResult } from "@/eval/judge";
import type { GoldenItem } from "@/eval/dataset/schema";

export type RetrievedHit = { reference: string; corpus: string; toolName?: string };

export type RunResult = {
  item: GoldenItem;
  mode: "deterministic" | "hybrid";
  retrievedReferences: string[];
  hits: RetrievedHit[];
  recall: number;
  precision: number;
  citationsResolve: boolean;        // every emitted citation resolves to a real verse
  lemmaRequired: boolean;
  lemmaFound: boolean;
  rerankStatus: string | null;      // from the searchSemantic tool-trace entry, if any
  faithfulness: FaithfulnessResult | null;
  answer?: string;                  // present only in judged mode when synthesis ran
};

function uniqueReferences(evidence: EvidencePacket): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of evidence.citations) {
    if (seen.has(c.reference)) continue;
    seen.add(c.reference);
    out.push(c.reference);
  }
  return out;
}

// Pull the rerank status the semantic call recorded in the tool trace (Finding 5:
// per-hit RRF source / rank position are not exposed; the trace's rerankStatus is).
function rerankStatusFrom(evidence: EvidencePacket): string | null {
  const entry = evidence.toolTrace.find((t) => t.tool === "searchSemantic");
  const args = entry?.args as { rerankStatus?: string } | undefined;
  return args?.rerankStatus ?? null;
}

// Core: ONE retrieval, all metrics derived from it. Returns the packet too so the
// judged path can synthesize from the same evidence.
async function runOnce(
  item: GoldenItem,
  semanticEnabled: boolean
): Promise<{ result: RunResult; evidence: EvidencePacket }> {
  const signals = extractSignals(item.question);
  const evidence = await runRetrievalPlan(signals, item.question, semanticEnabled);
  const retrieved = uniqueReferences(evidence);

  const claims = evidence.citations.map((c) => ({
    reference: c.reference,
    greekQuote: null,
    gloss: null,
    englishQuote: null
  }));
  const report = await verifyGrounding(claims);

  const lemmaRequired = Boolean(item.mustContainLemma);
  const lemmaFound = lemmaRequired
    ? evidence.formattedEvidence.includes(item.mustContainLemma as string)
    : false;

  const result: RunResult = {
    item,
    mode: semanticEnabled ? "hybrid" : "deterministic",
    retrievedReferences: retrieved,
    hits: evidence.citations.map((c) => ({ reference: c.reference, corpus: c.corpus, toolName: c.toolName })),
    recall: contextRecall(retrieved, item.goldenReferences),
    precision: contextPrecision(retrieved, item.goldenReferences),
    citationsResolve: report.grounded,
    lemmaRequired,
    lemmaFound,
    rerankStatus: rerankStatusFrom(evidence),
    faithfulness: null
  };
  return { result, evidence };
}

// GATE mode: deterministic, DB-only (semanticEnabled=false → no embedding egress,
// no rerank, key-free, reproducible).
export async function runDeterministic(item: GoldenItem): Promise<RunResult> {
  const { result } = await runOnce(item, false);
  return result;
}

// REPORT mode: full hybrid pipeline (semanticEnabled=true). Metrics AND the judged
// answer derive from the SAME packet. synthesizeWithRefinement returns null without
// an OpenAI client → no answer, faithfulness null. judgeFaithfulness returns null
// without AI_GATEWAY_API_KEY.
export async function runWithJudge(item: GoldenItem): Promise<RunResult> {
  const { result, evidence } = await runOnce(item, true);
  const routing = routeAssistantPrompt(item.question, false);
  const synth = await synthesizeWithRefinement({ prompt: item.question, evidence, routing });
  if (!synth) return result; // no live synthesis (no OpenAI key) → metrics only
  const faithfulness = await judgeFaithfulness(synth.answer, evidence);
  return { ...result, answer: synth.answer, faithfulness };
}
```

- [ ] **Step 2: Verify it type-checks** — Run: `npx tsc --noEmit --pretty false` → PASS. (If `ToolTraceEntry.args` typing rejects the `as` cast, import `ToolTraceEntry` from `@/lib/ai/toolTrace` and narrow accordingly — match the existing type.)

- [ ] **Step 3: Commit**

```bash
git add eval/runner.ts
git commit -m "Add eval runner: one EvidencePacket per mode; report synthesizes from same packet"
```

---

## Task 8: HTML + JSON report renderer

> **REQUIRED SUB-SKILL for this task:** invoke `frontend-design:frontend-design` before writing `renderHtmlReport`. Self-contained HTML (inline CSS, no external assets, no JS frameworks), editorial-scholar palette (`#f6f5f1` paper, `#1f2933` ink, `#365f7e` accent, `#d7d3ca` rules). Per-question cards use native `<details>`/`<summary>` (no JS). Top scorecard shows gate metrics + mean faithfulness + the run's status (whether hybrid retrieval and the judge actually ran). Side-by-side golden-vs-retrieved diff with ✓ hit / ✗ miss. Accessible, sufficient contrast.

**Files:** Create `eval/report.ts`; Test `tests/unit/eval/report.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eval/report.test.ts
import { describe, expect, it } from "vitest";
import { renderHtmlReport, renderJsonReport } from "@/eval/report";
import type { RunResult } from "@/eval/runner";

const sample: RunResult[] = [
  {
    item: { id: "john-3-16-exact", question: "What does John 3:16 say?", queryType: "exact-verse", goldenReferences: ["John 3:16"] },
    mode: "hybrid",
    retrievedReferences: ["John 3:16", "John 3:17"],
    hits: [
      { reference: "John 3:16", corpus: "SBLGNT", toolName: "getPassage" },
      { reference: "John 3:17", corpus: "SBLGNT", toolName: "searchSemantic" }
    ],
    recall: 1,
    precision: 0.5,
    citationsResolve: true,
    lemmaRequired: false,
    lemmaFound: false,
    rerankStatus: "ok",
    faithfulness: { score: 1, claims: [{ statement: "God so loved the world", supported: true, reason: "matches John 3:16" }], model: "anthropic/claude-sonnet-4-6" }
  }
];

describe("renderJsonReport", () => {
  it("round-trips results plus an aggregate summary", () => {
    const json = JSON.parse(renderJsonReport(sample));
    expect(json.summary.meanRecall).toBe(1);
    expect(json.summary.citationResolvability).toBe(1);
    expect(json.results).toHaveLength(1);
  });
});

describe("renderHtmlReport", () => {
  it("produces a self-contained HTML doc with the question, refs, and rerank status", () => {
    const html = renderHtmlReport(sample);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("What does John 3:16 say?");
    expect(html).toContain("John 3:16");
    expect(html).toContain("#365f7e");
    expect(html).toContain("ok");           // rerank status surfaced
    expect(html).not.toContain("<script src");
  });
  it("escapes HTML-special characters in question text", () => {
    const html = renderHtmlReport([{ ...sample[0], item: { ...sample[0].item, question: "love & <faith>" } }]);
    expect(html).toContain("love &amp; &lt;faith&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/eval/report.test.ts` → FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// eval/report.ts
import { aggregate, type Aggregate } from "@/eval/metrics";
import { THRESHOLDS } from "@/eval/thresholds";
import { canonicalizeReference } from "@/eval/references";
import type { RunResult } from "@/eval/runner";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function summaryOf(results: RunResult[]): Aggregate {
  return aggregate(results.map((r) => ({
    recall: r.recall, precision: r.precision, citationsResolve: r.citationsResolve,
    lemmaRequired: r.lemmaRequired, lemmaFound: r.lemmaFound
  })));
}

function meanFaithfulness(results: RunResult[]): number | null {
  const scored = results.filter((r) => r.faithfulness).map((r) => r.faithfulness!.score);
  return scored.length === 0 ? null : scored.reduce((a, b) => a + b, 0) / scored.length;
}

export function renderJsonReport(results: RunResult[]): string {
  return JSON.stringify(
    { generatedAt: new Date().toISOString(), thresholds: THRESHOLDS, summary: summaryOf(results), meanFaithfulness: meanFaithfulness(results), results },
    null,
    2
  );
}

function badge(pass: boolean): string {
  return pass ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
}

function refDiff(result: RunResult): string {
  const golden = new Set(result.item.goldenReferences.map((r) => canonicalizeReference(r) ?? r));
  const retrieved = new Set(result.retrievedReferences.map((r) => canonicalizeReference(r) ?? r));
  const goldenRows = [...golden].map((ref) => `<li class="${retrieved.has(ref) ? "hit" : "miss"}">${retrieved.has(ref) ? "✓" : "✗"} ${esc(ref)}</li>`).join("");
  const retrievedRows = [...retrieved].map((ref) => `<li class="${golden.has(ref) ? "hit" : "extra"}">${golden.has(ref) ? "✓" : "•"} ${esc(ref)}</li>`).join("");
  return `<div class="refcols"><div><h4>Golden (${golden.size})</h4><ul>${goldenRows}</ul></div><div><h4>Retrieved (${retrieved.size})</h4><ul>${retrievedRows}</ul></div></div>`;
}

function traceRows(result: RunResult): string {
  if (result.hits.length === 0) return `<p class="muted">No citations retrieved.</p>`;
  const rows = result.hits.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.reference)}</td><td>${esc(h.corpus)}</td><td>${esc(h.toolName ?? "")}</td></tr>`).join("");
  const rerank = result.rerankStatus ? `<p class="muted">rerank: ${esc(result.rerankStatus)}</p>` : "";
  return `<table class="trace"><thead><tr><th>#</th><th>Reference</th><th>Corpus</th><th>Tool</th></tr></thead><tbody>${rows}</tbody></table>${rerank}`;
}

function coverageBlock(result: RunResult): string {
  if (!result.lemmaRequired) return "";
  const lemma = esc(result.item.mustContainLemma ?? "");
  return `<p class="${result.lemmaFound ? "hit" : "miss"}">${result.lemmaFound ? "✓" : "✗"} required lemma ${lemma}</p>`;
}

function faithfulnessBlock(result: RunResult): string {
  if (!result.faithfulness) return "";
  const claims = result.faithfulness.claims.map((c) => `<li class="${c.supported ? "hit" : "miss"}">${c.supported ? "✓" : "✗"} ${esc(c.statement)} <span class="muted">— ${esc(c.reason)}</span></li>`).join("");
  return `<div class="faith"><h4>Faithfulness ${result.faithfulness.score.toFixed(2)} <span class="muted">(${esc(result.faithfulness.model)})</span></h4><ul>${claims}</ul></div>`;
}

function card(result: RunResult): string {
  const pass = result.recall >= THRESHOLDS.minRecall && result.citationsResolve && (!result.lemmaRequired || result.lemmaFound);
  return `<details class="card" ${pass ? "" : "open"}>
    <summary><span class="qt">${esc(result.item.queryType)}</span> ${esc(result.item.question)} ${badge(pass)}
      <span class="metric">R ${result.recall.toFixed(2)} · P ${result.precision.toFixed(2)} · ${result.citationsResolve ? "refs ✓" : "refs ✗"}</span></summary>
    ${refDiff(result)}
    ${coverageBlock(result)}
    <h4>Retrieval trace</h4>
    ${traceRows(result)}
    ${faithfulnessBlock(result)}
  </details>`;
}

export function renderHtmlReport(results: RunResult[]): string {
  const s = summaryOf(results);
  const f = meanFaithfulness(results);
  const judged = results.some((r) => r.faithfulness);
  const synthRan = results.some((r) => r.answer !== undefined);
  const scoreRow = (label: string, value: number, threshold: number) =>
    `<tr><td>${label}</td><td>${value.toFixed(3)}</td><td>${threshold}</td><td>${badge(value >= threshold)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TextLab Eval Report</title>
<style>
  :root { --bg:#f6f5f1; --ink:#1f2933; --surface:#fff; --muted:#6b7280; --border:#d7d3ca; --accent:#365f7e; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Inter Tight", system-ui, sans-serif; line-height:1.5; padding:2rem; }
  h1,h2,h3 { font-family:"Spectral", Georgia, serif; }
  .accent-rule { border-left:3px solid var(--accent); padding-left:.75rem; }
  table { border-collapse:collapse; width:100%; background:var(--surface); }
  th,td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--border); }
  .badge { font-size:.7rem; font-weight:600; padding:.1rem .45rem; border-radius:3px; }
  .badge.pass { background:#e3efe5; color:#1d6b3a; } .badge.fail { background:#f5e0e0; color:#9b2c2c; }
  .card { background:var(--surface); border:1px solid var(--border); border-left:3px solid var(--accent); margin:.75rem 0; padding:.5rem .9rem; border-radius:4px; }
  .card summary { cursor:pointer; }
  .qt { display:inline-block; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); margin-right:.5rem; }
  .metric { color:var(--muted); font-size:.8rem; margin-left:.5rem; }
  .refcols { display:flex; gap:2rem; margin:.6rem 0; }
  .refcols ul { list-style:none; padding:0; margin:0; font-variant-numeric:tabular-nums; }
  .hit { color:#1d6b3a; } .miss { color:#9b2c2c; } .extra { color:var(--muted); }
  .trace { font-size:.85rem; } .muted { color:var(--muted); }
  .faith { margin-top:.6rem; }
</style></head>
<body>
  <h1 class="accent-rule">TextLab Evaluation Report</h1>
  <p class="muted">Generated ${esc(new Date().toISOString())} · ${results.length} questions ·
    hybrid synthesis: ${synthRan ? "ran" : "off (no OPENAI_API_KEY)"} ·
    faithfulness judge: ${judged ? "ran" : "off (no AI_GATEWAY_API_KEY)"} ·
    mean faithfulness: ${f === null ? "n/a" : f.toFixed(2)}</p>
  <h2>Summary</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th><th>Threshold</th><th>Status</th></tr></thead>
    <tbody>
      ${scoreRow("Mean Context Recall", s.meanRecall, THRESHOLDS.meanRecall)}
      ${scoreRow("Mean Context Precision", s.meanPrecision, THRESHOLDS.meanPrecision)}
      ${scoreRow("Per-question recall floor", s.minRecall, THRESHOLDS.minRecall)}
      ${scoreRow("Required lemma/domain coverage", s.lemmaCoverage, THRESHOLDS.lemmaCoverage)}
      ${scoreRow("Citation resolvability", s.citationResolvability, THRESHOLDS.citationResolvability)}
    </tbody>
  </table>
  <h2>Questions</h2>
  ${results.map(card).join("\n")}
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/unit/eval/report.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/report.ts tests/unit/eval/report.test.ts
git commit -m "Add self-contained HTML + JSON eval report renderer"
```

---

## Task 9: Gate script + npm script

**Files:** Create `scripts/eval-gate.ts`; Modify `package.json`; add `.gitignore` entry

- [ ] **Step 1: Write the gate script**

```typescript
// scripts/eval-gate.ts
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema } from "@/eval/dataset/schema";
import { runDeterministic } from "@/eval/runner";
import { aggregate } from "@/eval/metrics";
import { THRESHOLDS } from "@/eval/thresholds";

async function main() {
  const items = goldenSetSchema.parse(goldenSet);
  const results = [];
  for (const item of items) results.push(await runDeterministic(item));

  const agg = aggregate(results.map((r) => ({
    recall: r.recall, precision: r.precision, citationsResolve: r.citationsResolve,
    lemmaRequired: r.lemmaRequired, lemmaFound: r.lemmaFound
  })));

  const checks = [
    { label: "Mean Context Recall", value: agg.meanRecall, min: THRESHOLDS.meanRecall },
    { label: "Mean Context Precision", value: agg.meanPrecision, min: THRESHOLDS.meanPrecision },
    { label: "Per-question recall floor", value: agg.minRecall, min: THRESHOLDS.minRecall },
    { label: "Required lemma/domain coverage", value: agg.lemmaCoverage, min: THRESHOLDS.lemmaCoverage },
    { label: "Citation resolvability", value: agg.citationResolvability, min: THRESHOLDS.citationResolvability }
  ];

  console.log(`\nTextLab eval gate (deterministic) — ${results.length} questions\n`);
  let failed = false;
  for (const c of checks) {
    const ok = c.value >= c.min;
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.label}: ${c.value.toFixed(3)} (>= ${c.min})`);
  }

  const worst = [...results].sort((a, b) => a.recall - b.recall).slice(0, 3);
  console.log("\nLowest-recall questions:");
  for (const r of worst) console.log(`  ${r.recall.toFixed(2)}  ${r.item.id} — ${r.item.question}`);

  // Name any question whose citations did not all resolve — actionable on failure.
  const unresolved = results.filter((r) => !r.citationsResolve);
  if (unresolved.length) {
    console.log("\nQuestions with unresolvable citations:");
    for (const r of unresolved) console.log(`  ${r.item.id} — ${r.item.question}`);
  }

  if (failed) { console.error("\nEval gate FAILED.\n"); process.exit(1); }
  console.log("\nEval gate passed.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the npm script** — in `package.json` scripts, after `"embed:verses"`, add:

```json
    "eval:gate": "tsx --env-file=.env.test scripts/eval-gate.ts",
```

(Mind the trailing comma on the previous line.)

- [ ] **Step 3: Ignore generated output** — add to `.gitignore`:

```
eval/output/
```

- [ ] **Step 4: Run the gate against the test DB** — Run: `npm run eval:gate`. It executes all questions with NO API key and prints per-metric PASS/FAIL. It MAY fail on the draft thresholds — fine at this step (Task 11 calibrates). What matters: it runs end-to-end, deterministically, with no crash and no key.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-gate.ts package.json .gitignore
git commit -m "Add deterministic eval:gate script"
```

---

## Task 10: Report script + npm script

**Files:** Create `scripts/eval-report.ts`; Modify `package.json`

- [ ] **Step 1: Write the report script**

```typescript
// scripts/eval-report.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema } from "@/eval/dataset/schema";
import { runWithJudge, type RunResult } from "@/eval/runner";
import { renderHtmlReport, renderJsonReport } from "@/eval/report";

async function main() {
  const items = goldenSetSchema.parse(goldenSet);
  const synth = Boolean(process.env.OPENAI_API_KEY);
  const judge = Boolean(process.env.AI_GATEWAY_API_KEY);
  console.log(`Running ${items.length} questions (live synthesis: ${synth ? "on" : "off"}, faithfulness judge: ${judge ? "on" : "off"})`);

  const results: RunResult[] = [];
  for (const item of items) {
    console.log(`  • ${item.id}`);
    results.push(await runWithJudge(item));
  }

  const outDir = path.join(process.cwd(), "eval", "output");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "report.html"), renderHtmlReport(results), "utf8");
  await writeFile(path.join(outDir, "report.json"), renderJsonReport(results), "utf8");
  console.log(`\nWrote eval/output/report.html and report.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the npm script** — after `"eval:gate"`, add:

```json
    "eval:report": "tsx --env-file=.env.test scripts/eval-report.ts",
```

> Uses `.env.test` for `DATABASE_URL`. Live synthesis runs only if `OPENAI_API_KEY` is present in the process env; faithfulness only if `AI_GATEWAY_API_KEY` is present (set `EVAL_JUDGE_MODEL` to override the default `anthropic/claude-sonnet-4-6`). Without either, the report still renders with retrieval-only metrics.

- [ ] **Step 3: Run the report** — Run: `npm run eval:report`. Writes `eval/output/report.{html,json}`. Open the HTML and confirm the scorecard, status line (synthesis/judge on/off), and collapsible per-question cards render with the editorial palette.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-report.ts package.json
git commit -m "Add eval:report script writing HTML + JSON hybrid quality dashboard"
```

---

## Task 11: Calibrate thresholds against the first real run

**Files:** Modify `eval/thresholds.ts`; tighten `tests/unit/eval/thresholds.test.ts`

> Do this only AFTER the maintainer has reviewed/approved the golden set (Task 5 checkpoint).

- [ ] **Step 1: Capture the baseline** — Run: `npm run eval:gate`. Read the printed mean recall, mean precision, min recall, coverage, and resolvability.

- [ ] **Step 2: Investigate any low scorer before lowering a threshold** — if it fails, run `npm run eval:report`, open `eval/output/report.html`, inspect the lowest-recall cards' golden-vs-retrieved diff and trace. Decide per case:
  - **Golden set is wrong** (a listed verse isn't really expected, or a real hit is missing) → fix `golden-set.json` and re-run. Common for the domain items flagged "VERIFY".
  - **Conceptual question under-recalls in the gate** → expected: the gate runs deterministic retrieval only, so conceptual recall reflects keyword/lemma matching, not vector search. Set the threshold below the achieved deterministic baseline; the hybrid recall is tracked in the nightly report, not gated.
  - **Citation resolvability < 100%** → a real bug (retrieval emitted a non-resolving reference). Do NOT lower this gate; investigate the offending question named in the gate output.
  - **Coverage < 100%** → a `mustContainLemma` item didn't surface its lemma; fix the dataset (wrong lemma form) or treat as a real retrieval finding.

- [ ] **Step 3: Set thresholds to lock in the achieved baseline** — edit `eval/thresholds.ts` so `meanRecall`/`meanPrecision`/`minRecall` sit at or just below observed values (2 decimals); keep `citationResolvability: 1` and `lemmaCoverage: 1`. Example if the run yields recall 0.94 / precision 0.86 / min-recall 0.67:

```typescript
export const THRESHOLDS = {
  meanRecall: 0.92,
  meanPrecision: 0.85,
  minRecall: 0.6,
  citationResolvability: 1,
  lemmaCoverage: 1
} as const;
```

- [ ] **Step 4: Tighten the threshold test to exact values (Finding 6)** — replace the bounds-only assertions with exact-value assertions matching the calibrated numbers, so a later accidental edit is caught:

```typescript
// tests/unit/eval/thresholds.test.ts (add to the existing describe)
it("matches the calibrated baseline exactly", () => {
  expect(THRESHOLDS).toEqual({
    meanRecall: 0.92,        // ← use the values you committed in Step 3
    meanPrecision: 0.85,
    minRecall: 0.6,
    citationResolvability: 1,
    lemmaCoverage: 1
  });
});
```

- [ ] **Step 5: Confirm green** — Run: `npm run eval:gate` → exit 0. Run: `npx vitest run tests/unit/eval/thresholds.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add eval/thresholds.ts tests/unit/eval/thresholds.test.ts
git commit -m "Calibrate eval gate thresholds to first-run baseline; assert exact values"
```

---

## Task 12: Integration smoke test for the runner

**Files:** Create `tests/integration/eval-runner.test.ts`

- [ ] **Step 1: Confirm the integration test pattern** — read an existing file under `tests/integration/` (e.g. `tests/integration/fts-search.test.ts`) and copy its exact `DATABASE_URL`-guard / skip idiom. Mirror it.

- [ ] **Step 2: Write the test**

```typescript
// tests/integration/eval-runner.test.ts
import { describe, expect, it } from "vitest";
import { runDeterministic } from "@/eval/runner";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("eval runner (integration)", () => {
  it("runs an exact-verse question end-to-end and produces a well-formed RunResult", async () => {
    const result = await runDeterministic({
      id: "smoke-john-3-16",
      question: "What does John 3:16 say?",
      queryType: "exact-verse",
      goldenReferences: ["John 3:16"]
    });
    expect(result.retrievedReferences).toContain("John 3:16");
    expect(result.recall).toBe(1);
    expect(result.citationsResolve).toBe(true);
    expect(result.mode).toBe("deterministic");
    expect(typeof result.precision).toBe("number");
  }, 30_000);
});
```

> If `describe.runIf` is not the idiom the existing integration tests use, match whatever they do — the existing files are the source of truth.

- [ ] **Step 3: Run the integration suite** — Run: `npm run test:integration` → the new test PASSES against the Neon test branch (existing integration tests stay green).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/eval-runner.test.ts
git commit -m "Add eval-runner integration smoke test"
```

---

## Task 13: Wire the gate into CI + docs

**Files:** Modify `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: Gate wiring decision** — `npm run verify` (`package.json:15`) is `lint && tsc && build && test:coverage` and needs no DB. `eval:gate` needs `DATABASE_URL`. Do NOT fold `eval:gate` into `verify`. Add it as a separate documented CI step alongside `test:integration` / `test:acceptance`.

- [ ] **Step 2: Update README** — add an "Evaluation harness" subsection:
  - `npm run eval:gate` — deterministic, DB-only, **blocking** PR gate. Protects deterministic evidence retrieval and citation safety: Context Precision/Recall, required lemma/domain coverage, 100% citation resolvability. No API key. Dataset at `eval/dataset/golden-set.json`.
  - `npm run eval:report` — **non-blocking** nightly/on-demand hybrid quality report. Runs the full pipeline (pgvector + RRF + rerank + synthesis), adds LLM-judge faithfulness via the Vercel AI Gateway (`EVAL_JUDGE_MODEL`, default `anthropic/claude-sonnet-4-6`, gated on `AI_GATEWAY_API_KEY`; live synthesis gated on `OPENAI_API_KEY`). Writes `eval/output/report.{html,json}`.
  - State explicitly: the gate protects deterministic retrieval + citation safety; the report monitors full hybrid-pipeline quality and faithfulness. Generative-hallucination protection lives in the production runtime grounding verifier + the nightly report.

- [ ] **Step 3: Update PROJECT_STATE.md**
  - Move Phase 6 to ✅ done in the Milestone 3 section; update the snapshot header.
  - Add a "Test surfaces" entry: the two-tier eval harness (deterministic gate metrics + calibrated thresholds; nightly hybrid report + gateway judge; golden set size + query-type coverage).
  - Keep the prose-sweep grounding hardening flagged as an open follow-up (NOT closed by Phase 6).

- [ ] **Step 4: Update the roadmap** — in `docs/HiFi-exegesis-nt-roadmap.md`, mark Phase 6 ✅ done with a one-line summary (two-tier: deterministic gate + nightly hybrid/faithfulness report).

- [ ] **Step 5: Run full verification**

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run verify
npm run test:integration
npm run eval:gate
```
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/PROJECT_STATE.md docs/HiFi-exegesis-nt-roadmap.md
git commit -m "Document Phase 6 two-tier evaluation harness; mark phase done"
```

---

## Self-review notes (author)

- **Spec coverage:** two-tier framing (T7 modes, T9 gate, T10 report) · dataset (T1,T5) · precision/recall (T3) · required lemma/domain coverage (T3 aggregate + T7 lemmaFound + T9 gate) · citation resolvability (T3,T7,T9 — renamed from grounding, reference-only `verifyGrounding`) · deterministic blocking gate + calibrated/exact thresholds (T4,T9,T11) · gateway LLM-judge faithfulness, nightly (T6,T7,T10) · single-EvidencePacket per mode (T7 — Finding 3) · HTML+JSON report with golden-vs-retrieved + trace incl. rerank status + coverage + faithfulness (T8 — Finding 5) · unit+integration tests (T2–T8,T12) · docs (T13). Out-of-scope items (prose-sweep grounding, embedding/rerank fixtures, branch-coverage gate, auto-derived questions) not implemented.
- **Findings resolved:** (1) gate is deterministic-only by design; hybrid quality in nightly report — spec + plan say so explicitly. (2) metric renamed to citation resolvability; hallucination guard documented as runtime + nightly. (3) one packet per mode; report synthesizes from the same packet via `synthesizeWithRefinement`. (4) lemma/domain coverage is a 100% gate check. (5) report trace shows `toolName` + rerank status (no invented rank provenance). (6) thresholds test asserts exact calibrated values after Task 11.
- **Implementer must verify against live code (flagged inline, not placeholders):** `ai` SDK `generateObject` export + gateway string routing (mirror `rerank.ts`); `ToolTraceEntry.args` typing for the rerank-status read; integration-test skip idiom. Each task names the source-of-truth file.
- **Type consistency:** `RunResult` (T7) consumed by `report.ts` (T8), `eval-gate.ts` (T9), `eval-report.ts` (T10), integration test (T12). `QuestionScore`/`Aggregate` (T3) reused in `report.ts`/`eval-gate.ts`. `THRESHOLDS` keys (`meanRecall`, `meanPrecision`, `minRecall`, `citationResolvability`, `lemmaCoverage`) identical across `thresholds.ts`, its test, `report.ts`, and `eval-gate.ts`.
