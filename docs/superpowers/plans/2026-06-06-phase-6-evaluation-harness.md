# Phase 6 — Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `eval/` harness that drives the existing retrieval pipeline against a curated golden NT-exegesis dataset, enforces deterministic Context Precision/Recall + grounding as a blocking PR gate, and produces a non-blocking nightly HTML dashboard with LLM-as-judge faithfulness.

**Architecture:** A leaf `eval/` module imports from `lib/ai/*` and `lib/search.ts` but is imported by nothing in `app/`/`lib/`, so it cannot affect runtime. A shared `runner` executes each golden question through `extractSignals → runRetrievalPlan` (+ `verifyGrounding`, + optional live `answerBibleQuestion`/judge). `metrics.ts` scores the `EvidencePacket` citations against golden references. `scripts/eval-gate.ts` exits non-zero on threshold breach (deterministic, DB-only); `scripts/eval-report.ts` writes a self-contained HTML+JSON report (adds live faithfulness when `OPENAI_API_KEY` is set).

**Tech Stack:** TypeScript, tsx (script runner), Vitest 4 (unit/integration), zod 3 (dataset validation), Prisma 6 over the Neon test branch (`.env.test`). No new dependencies.

---

## Key facts the implementer must know (verified against the codebase)

- **Reference format is `<osisId> <chapter>:<verse>`** — e.g. `1Cor 13:1`, `John 3:16`, `Rom 8:28`. Produced by `formatReference(osisId, chapter, verse)` in `lib/references.ts:1`. `parseReference(input)` (`lib/references.ts:50`) returns `{ book, chapter, verse, verseEnd? } | null`, normalizing book aliases via `normalizeBook`. Use osisId spellings: `Matt, Mark, Luke, John, Acts, Rom, 1Cor, 2Cor, Gal, Eph, Phil, Col, 1Thess, 2Thess, 1Tim, 2Tim, Titus, Phlm, Heb, Jas, 1Pet, 2Pet, 1John, 2John, 3John, Jude, Rev`.
- **Pipeline entry points** (all already exist):
  - `extractSignals(prompt: string): Signals` — `lib/ai/signals.ts:394`.
  - `runRetrievalPlan(signals: Signals, prompt = "", semanticEnabled = true): Promise<EvidencePacket>` — `lib/ai/retrievalPlanner.ts:563`. `EvidencePacket = { citations: AssistantCitation[]; toolTrace: ToolTraceEntry[]; formattedEvidence: string }`.
  - `AssistantCitation = { reference: string; corpus: string; searchQuery: string; toolName?: string; book?: string; chapter?: number; verse?: number; tokenId?: string }` — `lib/ai/assistant.ts:23`. `reference` is the canonical string above.
  - `verifyGrounding(claims: GroundingClaim[]): Promise<GroundingReport>` — `lib/ai/grounding.ts:72`. `GroundingReport = { grounded: boolean; verdicts: ClaimVerdict[] }`. `GroundingClaim = { reference: string; greekQuote: string | null; gloss: string | null; englishQuote: string | null }`.
  - `answerBibleQuestion(prompt, { escalate? }): Promise<AssistantAnswer>` — `lib/ai/assistant.ts:49`. In live mode (`OPENAI_API_KEY` set) returns synthesized `answer` + `groundingReport`; in fallback mode returns the deterministic answer. `AssistantAnswer.mode` is `"live" | "fallback"`.
- **Scripts run via `tsx --env-file=<file>`** (see `package.json:22-25`). `.env.test` points `DATABASE_URL`/`DIRECT_URL` at the seeded Neon test branch (used by `test:integration`/`test:acceptance`).
- **Editorial-scholar palette** (from `app/globals.css:5-13`): `--background:#f6f5f1; --foreground:#1f2933; --surface:#ffffff; --muted:#6b7280; --border:#d7d3ca; --accent:#365f7e;`. Display serif: Spectral; UI sans: Inter Tight; Greek: Gentium Plus.
- **Integration-test convention:** integration suites live under `tests/integration/`, run via `vitest.integration.config.ts`, and **skip themselves when `DATABASE_URL` is unset**. Unit tests live under `tests/unit/`.

---

## File structure

| Path | Responsibility |
|---|---|
| `eval/dataset/schema.ts` | zod schema + TS types for a golden item and the dataset; `QUERY_TYPES` constant |
| `eval/dataset/golden-set.json` | ~20 curated questions with golden references (committed) |
| `eval/thresholds.ts` | Gate threshold constants (single source of truth) |
| `eval/references.ts` | `canonicalizeReference` + set-comparison helpers (normalize via `parseReference`) |
| `eval/metrics.ts` | `contextPrecision`, `contextRecall`, `scoreQuestion`, `aggregate` |
| `eval/runner.ts` | `runDeterministic(item)` and `runWithJudge(item)` → `RunResult` |
| `eval/judge.ts` | `judgeFaithfulness(answer, evidence)` (LLM-as-judge; key-gated) |
| `eval/report.ts` | `renderHtmlReport(results)` + `renderJsonReport(results)` |
| `eval/output/` | gitignored: `report.html`, `report.json` |
| `scripts/eval-gate.ts` | `npm run eval:gate` — deterministic, exit code |
| `scripts/eval-report.ts` | `npm run eval:report` — full run + HTML/JSON |
| `tests/unit/eval/references.test.ts` | canonicalization + comparison helpers |
| `tests/unit/eval/metrics.test.ts` | precision/recall math + aggregation |
| `tests/unit/eval/dataset.test.ts` | golden-set validates against schema; all query types present; refs parse |
| `tests/unit/eval/thresholds.test.ts` | threshold sanity bounds |
| `tests/unit/eval/report.test.ts` | HTML/JSON render smoke (no live calls) |
| `tests/integration/eval-runner.test.ts` | one question end-to-end against the test DB |

---

## Task 1: Dataset schema and types

**Files:**
- Create: `eval/dataset/schema.ts`
- Test: `tests/unit/eval/dataset.test.ts` (extended in Task 3)

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
  // Canonical "<osisId> <chapter>:<verse>" strings, e.g. "1Cor 13:1".
  goldenReferences: z.array(z.string().min(1)).min(1),
  // Optional: retrieval must surface this Greek lemma somewhere in evidence.
  mustContainLemma: z.string().min(1).optional(),
  notes: z.string().optional()
});

export const goldenSetSchema = z.array(goldenItemSchema).min(1);

export type GoldenItem = z.infer<typeof goldenItemSchema>;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit --pretty false`
Expected: PASS (no errors referencing `eval/dataset/schema.ts`).

- [ ] **Step 3: Commit**

```bash
git add eval/dataset/schema.ts
git commit -m "Add golden-set schema and query-type constants for eval harness"
```

---

## Task 2: Reference canonicalization helpers

**Files:**
- Create: `eval/references.ts`
- Test: `tests/unit/eval/references.test.ts`

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
    expect(a.size).toBe(2); // the two 1Cor 13:1 spellings collapse
    expect(intersectionSize(a, b)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eval/references.test.ts`
Expected: FAIL — cannot resolve `@/eval/references`.

- [ ] **Step 3: Write the implementation**

```typescript
// eval/references.ts
import { formatReference, parseReference } from "@/lib/references";

// Normalize any accepted reference spelling to the codebase's canonical
// "<osisId> <chapter>:<verse>" form. Returns null when unparseable.
export function canonicalizeReference(input: string): string | null {
  const parsed = parseReference(input);
  if (!parsed) return null;
  return formatReference(parsed.book, parsed.chapter, parsed.verse);
}

// Build a Set of canonical references, dropping anything unparseable.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eval/references.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add eval/references.ts tests/unit/eval/references.test.ts
git commit -m "Add canonical reference helpers for eval metrics"
```

---

## Task 3: Metrics (precision / recall / aggregation)

**Files:**
- Create: `eval/metrics.ts`
- Test: `tests/unit/eval/metrics.test.ts`

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
  it("computes means and the per-question recall floor", () => {
    const agg = aggregate([
      { recall: 1, precision: 1, grounded: true },
      { recall: 0.4, precision: 0.8, grounded: true }
    ]);
    expect(agg.meanRecall).toBeCloseTo(0.7);
    expect(agg.meanPrecision).toBeCloseTo(0.9);
    expect(agg.minRecall).toBe(0.4);
    expect(agg.groundingPassRate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eval/metrics.test.ts`
Expected: FAIL — cannot resolve `@/eval/metrics`.

- [ ] **Step 3: Write the implementation**

```typescript
// eval/metrics.ts
import { intersectionSize, referenceSet } from "@/eval/references";

// recall = |retrieved ∩ golden| / |golden|. Empty golden → 1 (nothing to miss).
export function contextRecall(retrieved: string[], golden: string[]): number {
  const goldenSet = referenceSet(golden);
  if (goldenSet.size === 0) return 1;
  const retrievedSet = referenceSet(retrieved);
  return intersectionSize(retrievedSet, goldenSet) / goldenSet.size;
}

// precision = |retrieved ∩ golden| / |retrieved|. Empty retrieved → 1 if golden
// also empty (nothing wrong was returned), else 0 (nothing relevant surfaced).
export function contextPrecision(retrieved: string[], golden: string[]): number {
  const retrievedSet = referenceSet(retrieved);
  if (retrievedSet.size === 0) return referenceSet(golden).size === 0 ? 1 : 0;
  const goldenSet = referenceSet(golden);
  return intersectionSize(retrievedSet, goldenSet) / retrievedSet.size;
}

export type QuestionScore = { recall: number; precision: number; grounded: boolean };

export type Aggregate = {
  meanRecall: number;
  meanPrecision: number;
  minRecall: number;
  groundingPassRate: number;
  count: number;
};

export function aggregate(scores: QuestionScore[]): Aggregate {
  if (scores.length === 0) {
    return { meanRecall: 1, meanPrecision: 1, minRecall: 1, groundingPassRate: 1, count: 0 };
  }
  const mean = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;
  return {
    meanRecall: mean(scores.map((s) => s.recall)),
    meanPrecision: mean(scores.map((s) => s.precision)),
    minRecall: Math.min(...scores.map((s) => s.recall)),
    groundingPassRate: mean(scores.map((s) => (s.grounded ? 1 : 0))),
    count: scores.length
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eval/metrics.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add eval/metrics.ts tests/unit/eval/metrics.test.ts
git commit -m "Add context precision/recall + aggregation metrics for eval harness"
```

---

## Task 4: Threshold constants

**Files:**
- Create: `eval/thresholds.ts`
- Test: `tests/unit/eval/thresholds.test.ts`

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
  it("requires a perfect grounding pass-rate", () => {
    expect(THRESHOLDS.groundingPassRate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eval/thresholds.test.ts`
Expected: FAIL — cannot resolve `@/eval/thresholds`.

- [ ] **Step 3: Write the implementation**

```typescript
// eval/thresholds.ts
// Starting values — CALIBRATE against the first real run (Task 11) so the gate
// starts green, then ratchet up. A unit test guards these bounds.
export const THRESHOLDS = {
  meanRecall: 0.9,
  meanPrecision: 0.8,
  groundingPassRate: 1,
  minRecall: 0.5
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eval/thresholds.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add eval/thresholds.ts tests/unit/eval/thresholds.test.ts
git commit -m "Add eval gate thresholds with sanity-bound test"
```

---

## Task 5: Curated golden dataset + validation test

**Files:**
- Create: `eval/dataset/golden-set.json`
- Test: `tests/unit/eval/dataset.test.ts`

> **Maintainer review checkpoint:** the question set below is a STARTING draft. Submit it to the maintainer for review before calibrating thresholds (Task 11). Each of the five `queryType`s must appear at least once. Golden references must be real NT verses in canonical `<osisId> <chapter>:<verse>` form.

- [ ] **Step 1: Write the dataset (≈20 items spanning all five query types)**

```json
[
  {
    "id": "john-3-16-exact",
    "question": "What does John 3:16 say?",
    "queryType": "exact-verse",
    "goldenReferences": ["John 3:16"],
    "notes": "Single exact-verse lookup; deterministic passageCall path."
  },
  {
    "id": "rom-8-28-exact",
    "question": "Explain Romans 8:28.",
    "queryType": "exact-verse",
    "goldenReferences": ["Rom 8:28"],
    "notes": "Exact-verse; tests no-noise precision on a pinpointed prompt."
  },
  {
    "id": "matt-6-9-exact",
    "question": "What is written in Matthew 6:9?",
    "queryType": "exact-verse",
    "goldenReferences": ["Matt 6:9"],
    "notes": "Exact-verse lookup."
  },
  {
    "id": "agape-1cor13-lemma",
    "question": "Where does the Greek word ἀγάπη appear in 1 Corinthians 13?",
    "queryType": "lemma-survey",
    "goldenReferences": ["1Cor 13:1", "1Cor 13:2", "1Cor 13:3", "1Cor 13:4", "1Cor 13:8", "1Cor 13:13"],
    "mustContainLemma": "ἀγάπη",
    "notes": "Lemma survey scoped to one chapter; searchLemma path."
  },
  {
    "id": "pistis-rom-lemma",
    "question": "Occurrences of the lemma πίστις in Romans 4.",
    "queryType": "lemma-survey",
    "goldenReferences": ["Rom 4:5", "Rom 4:9", "Rom 4:11", "Rom 4:12", "Rom 4:13", "Rom 4:14", "Rom 4:16", "Rom 4:19", "Rom 4:20"],
    "mustContainLemma": "πίστις",
    "notes": "Lemma survey in a single chapter."
  },
  {
    "id": "logos-john1-lemma",
    "question": "Where does λόγος appear in John 1?",
    "queryType": "lemma-survey",
    "goldenReferences": ["John 1:1", "John 1:14"],
    "mustContainLemma": "λόγος",
    "notes": "Lemma survey; the famous prologue occurrences."
  },
  {
    "id": "charis-eph2-lemma",
    "question": "Find the word χάρις in Ephesians 2.",
    "queryType": "lemma-survey",
    "goldenReferences": ["Eph 2:5", "Eph 2:7", "Eph 2:8"],
    "mustContainLemma": "χάρις",
    "notes": "Lemma survey scoped to one chapter."
  },
  {
    "id": "reconciliation-conceptual",
    "question": "What does the New Testament teach about reconciliation with God?",
    "queryType": "conceptual",
    "goldenReferences": ["Rom 5:10", "Rom 5:11", "2Cor 5:18", "2Cor 5:19", "2Cor 5:20", "Col 1:20", "Col 1:21", "Col 1:22"],
    "notes": "Conceptual; exercises the semantic/RRF+rerank path. Golden = canonical reconciliation loci."
  },
  {
    "id": "justification-faith-conceptual",
    "question": "How is a person justified by faith?",
    "queryType": "conceptual",
    "goldenReferences": ["Rom 3:28", "Rom 5:1", "Gal 2:16", "Gal 3:24", "Eph 2:8", "Eph 2:9"],
    "notes": "Conceptual/topical; semantic recall across books."
  },
  {
    "id": "fruit-of-spirit-conceptual",
    "question": "What is the fruit of the Spirit?",
    "queryType": "conceptual",
    "goldenReferences": ["Gal 5:22", "Gal 5:23"],
    "notes": "Conceptual but tightly localized; precision check on a focused concept."
  },
  {
    "id": "love-neighbor-conceptual",
    "question": "What does Jesus teach about loving your neighbor?",
    "queryType": "conceptual",
    "goldenReferences": ["Matt 22:39", "Mark 12:31", "Luke 10:27", "Rom 13:9", "Gal 5:14"],
    "notes": "Conceptual; cross-book semantic recall of a teaching theme."
  },
  {
    "id": "sexual-immorality-conceptual",
    "question": "What does Paul say about sexual immorality?",
    "queryType": "conceptual",
    "goldenReferences": ["1Cor 6:18", "1Thess 4:3", "Gal 5:19", "Eph 5:3"],
    "notes": "Phrase-term conceptual prompt; exercises phraseTerms → semantic+FTS."
  },
  {
    "id": "domain-33-communication",
    "question": "Show me words in Louw-Nida domain 33 in James 3.",
    "queryType": "domain",
    "goldenReferences": ["Jas 3:2", "Jas 3:5", "Jas 3:6", "Jas 3:8", "Jas 3:9", "Jas 3:10"],
    "notes": "Domain mode; 'domain 33' (Communication) anchored signal → domainCall, scoped to one chapter."
  },
  {
    "id": "domain-ln-25-love",
    "question": "Find Louw-Nida 25.43 occurrences in 1 John 4.",
    "queryType": "domain",
    "goldenReferences": ["1John 4:7", "1John 4:8", "1John 4:10", "1John 4:11", "1John 4:12", "1John 4:16", "1John 4:18", "1John 4:19", "1John 4:20", "1John 4:21"],
    "notes": "Domain mode; explicit LN reference (25.43, 'to love') → domainCall. VERIFY exact verse set against seeded data during review."
  },
  {
    "id": "domain-88-moral-rom1",
    "question": "Words in domain 88 in Romans 1.",
    "queryType": "domain",
    "goldenReferences": ["Rom 1:29", "Rom 1:30", "Rom 1:31"],
    "notes": "Domain mode (Moral/Ethical qualities). VERIFY against seeded data during review."
  },
  {
    "id": "beatitudes-cross-chapter",
    "question": "Walk through the Sermon on the Mount from Matthew 5:1 to 5:12.",
    "queryType": "cross-chapter",
    "goldenReferences": ["Matt 5:1", "Matt 5:2", "Matt 5:3", "Matt 5:4", "Matt 5:5", "Matt 5:6", "Matt 5:7", "Matt 5:8", "Matt 5:9", "Matt 5:10", "Matt 5:11", "Matt 5:12"],
    "notes": "In-chapter range; passageCall range assembly."
  },
  {
    "id": "love-chapter-cross-chapter",
    "question": "Discuss 2 Corinthians 4:16 through 5:10.",
    "queryType": "cross-chapter",
    "goldenReferences": ["2Cor 4:16", "2Cor 4:17", "2Cor 4:18", "2Cor 5:1", "2Cor 5:2", "2Cor 5:3", "2Cor 5:4", "2Cor 5:5", "2Cor 5:6", "2Cor 5:7", "2Cor 5:8", "2Cor 5:9", "2Cor 5:10"],
    "notes": "True cross-chapter range (chapterEnd); per-chapter getPassage fan-out."
  },
  {
    "id": "armor-of-god-cross-chapter",
    "question": "Explain the armor of God in Ephesians 6:10-18.",
    "queryType": "cross-chapter",
    "goldenReferences": ["Eph 6:10", "Eph 6:11", "Eph 6:12", "Eph 6:13", "Eph 6:14", "Eph 6:15", "Eph 6:16", "Eph 6:17", "Eph 6:18"],
    "notes": "In-chapter range."
  },
  {
    "id": "resurrection-1cor15-conceptual",
    "question": "What does Paul argue about the resurrection of the dead?",
    "queryType": "conceptual",
    "goldenReferences": ["1Cor 15:12", "1Cor 15:13", "1Cor 15:14", "1Cor 15:20", "1Cor 15:21", "1Cor 15:22"],
    "notes": "Conceptual; semantic recall should concentrate in 1 Cor 15."
  },
  {
    "id": "faith-hope-love-exact",
    "question": "What does 1 Corinthians 13:13 say about faith, hope, and love?",
    "queryType": "exact-verse",
    "goldenReferences": ["1Cor 13:13"],
    "notes": "Exact-verse with topical phrasing; should still pin to the single verse."
  }
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

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/eval/dataset.test.ts`
Expected: PASS. If a reference fails to parse, fix the osisId spelling in the JSON.

> **Note:** importing `.json` requires `resolveJsonModule` (TS) — already enabled in Next.js `tsconfig.json` by default (`"resolveJsonModule": true`). If tsc complains, confirm that flag is set before changing anything else.

- [ ] **Step 4: Commit**

```bash
git add eval/dataset/golden-set.json tests/unit/eval/dataset.test.ts
git commit -m "Add curated NT-exegesis golden set + validation test (draft for review)"
```

---

## Task 6: LLM-as-judge faithfulness (nightly only)

**Files:**
- Create: `eval/judge.ts`

> The judge runs only in the nightly/on-demand report, never in the gate. It is key-gated: with no `OPENAI_API_KEY` it returns `null` (skipped), never a failure. Reuse the shared client at `lib/ai/openaiClient.ts`.

- [ ] **Step 1: Inspect the shared OpenAI client**

Run: `npx vitest run --reporter=dot tests/unit/eval/metrics.test.ts` (sanity that the suite runs), then read `lib/ai/openaiClient.ts` to confirm the export name (`getOpenAIClient` or similar) and the model env var used elsewhere (`OPENAI_MODEL`). Use whatever the file actually exports — do not invent a name.

- [ ] **Step 2: Write the implementation**

```typescript
// eval/judge.ts
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

export type FaithfulnessClaim = { statement: string; supported: boolean; reason: string };
export type FaithfulnessResult = { score: number; claims: FaithfulnessClaim[] };

// LLM-as-judge faithfulness: decompose the answer into atomic statements and
// judge each against the retrieved evidence. Returns null when no API key is set
// (nightly-only signal; must never block or throw the gate).
export async function judgeFaithfulness(
  answer: string,
  evidence: EvidencePacket
): Promise<FaithfulnessResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  // NOTE: import lazily so the gate path (Task 9) never loads the OpenAI client.
  const { getOpenAIClient } = await import("@/lib/ai/openaiClient");
  const client = getOpenAIClient();

  const system =
    "You are a strict faithfulness judge for a Bible-study assistant. " +
    "Given an ANSWER and the EVIDENCE it was built from, break the answer into " +
    "atomic factual statements. For each, decide whether it is directly supported " +
    "by the EVIDENCE. Do not use outside knowledge. Respond as JSON.";

  const user =
    `EVIDENCE:\n${evidence.formattedEvidence}\n\nANSWER:\n${answer}`;

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-5.4",
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "faithfulness",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["claims"],
          properties: {
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["statement", "supported", "reason"],
                properties: {
                  statement: { type: "string" },
                  supported: { type: "boolean" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  });

  const parsed = JSON.parse(response.output_text) as { claims: FaithfulnessClaim[] };
  const claims = parsed.claims ?? [];
  const supported = claims.filter((c) => c.supported).length;
  const score = claims.length === 0 ? 1 : supported / claims.length;
  return { score, claims };
}
```

> **Implementer note:** the exact `responses.create` shape (`text.format` vs `response_format`, `output_text` accessor) MUST match how `lib/ai/synthesis.ts` already calls the SDK. Open `lib/ai/synthesis.ts` (the `responses.create` call around line 200-250) and mirror its option names and output parsing exactly. If they differ from the sketch above, follow synthesis.ts — it is the source of truth for the installed `openai@4` version.

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add eval/judge.ts
git commit -m "Add LLM-as-judge faithfulness scorer (nightly-only, key-gated)"
```

---

## Task 7: Runner (deterministic + judged)

**Files:**
- Create: `eval/runner.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// eval/runner.ts
import { extractSignals } from "@/lib/ai/signals";
import { runRetrievalPlan, type EvidencePacket } from "@/lib/ai/retrievalPlanner";
import { verifyGrounding } from "@/lib/ai/grounding";
import { answerBibleQuestion } from "@/lib/ai/assistant";
import { contextPrecision, contextRecall } from "@/eval/metrics";
import { judgeFaithfulness, type FaithfulnessResult } from "@/eval/judge";
import type { GoldenItem } from "@/eval/dataset/schema";

export type RetrievedHit = { reference: string; corpus: string; toolName?: string };

export type RunResult = {
  item: GoldenItem;
  retrievedReferences: string[];   // unique canonical-ish references from citations
  hits: RetrievedHit[];            // full citation detail for the report's trace view
  recall: number;
  precision: number;
  grounded: boolean;
  lemmaFound: boolean | null;      // null when item has no mustContainLemma
  faithfulness: FaithfulnessResult | null; // null in deterministic mode / no key
  answer?: string;                 // present only in judged mode
};

// Distinct references from the evidence packet, preserving first-seen order.
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

function evidenceMentionsLemma(evidence: EvidencePacket, lemma: string): boolean {
  return evidence.formattedEvidence.includes(lemma);
}

// Deterministic path: retrieval + grounding only. No network beyond the DB
// (semanticEnabled=false so no embedding egress; key-free, reproducible).
export async function runDeterministic(item: GoldenItem): Promise<RunResult> {
  const signals = extractSignals(item.question);
  const evidence = await runRetrievalPlan(signals, item.question, false);
  const retrieved = uniqueReferences(evidence);

  const claims = evidence.citations.map((c) => ({
    reference: c.reference,
    greekQuote: null,
    gloss: null,
    englishQuote: null
  }));
  const report = await verifyGrounding(claims);

  return {
    item,
    retrievedReferences: retrieved,
    hits: evidence.citations.map((c) => ({ reference: c.reference, corpus: c.corpus, toolName: c.toolName })),
    recall: contextRecall(retrieved, item.goldenReferences),
    precision: contextPrecision(retrieved, item.goldenReferences),
    grounded: report.grounded,
    lemmaFound: item.mustContainLemma ? evidenceMentionsLemma(evidence, item.mustContainLemma) : null,
    faithfulness: null
  };
}

// Judged path (nightly): everything deterministic does, PLUS a live answer and
// LLM-as-judge faithfulness. semanticEnabled=true here so the live pipeline runs
// end-to-end. Faithfulness is null when no API key is set.
export async function runWithJudge(item: GoldenItem): Promise<RunResult> {
  const base = await runDeterministic(item);
  const signals = extractSignals(item.question);
  const evidence = await runRetrievalPlan(signals, item.question, true);
  const answer = await answerBibleQuestion(item.question);
  const faithfulness = await judgeFaithfulness(answer.answer, evidence);
  return { ...base, faithfulness, answer: answer.answer };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit --pretty false`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add eval/runner.ts
git commit -m "Add eval runner (deterministic + judged paths)"
```

---

## Task 8: HTML + JSON report renderer

> **REQUIRED SUB-SKILL for this task:** invoke `frontend-design:frontend-design` before writing `renderHtmlReport`. The report is a self-contained HTML document (inline CSS, no external assets, no JS frameworks) styled in the editorial-scholar palette (`#f6f5f1` paper, `#1f2933` ink, `#365f7e` accent, `#d7d3ca` rules). Per-question cards must be **functional**: use native `<details>`/`<summary>` for collapsible cards (no JS dependency), a summary scorecard at top with pass/fail badges, and a side-by-side golden-vs-retrieved reference diff with ✓ hit / ✗ miss markers. Keep it accessible (semantic HTML, sufficient contrast).

**Files:**
- Create: `eval/report.ts`
- Test: `tests/unit/eval/report.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/eval/report.test.ts
import { describe, expect, it } from "vitest";
import { renderHtmlReport, renderJsonReport } from "@/eval/report";
import type { RunResult } from "@/eval/runner";

const sample: RunResult[] = [
  {
    item: { id: "john-3-16-exact", question: "What does John 3:16 say?", queryType: "exact-verse", goldenReferences: ["John 3:16"] },
    retrievedReferences: ["John 3:16", "John 3:17"],
    hits: [
      { reference: "John 3:16", corpus: "SBLGNT", toolName: "getPassage" },
      { reference: "John 3:17", corpus: "SBLGNT", toolName: "getPassage" }
    ],
    recall: 1,
    precision: 0.5,
    grounded: true,
    lemmaFound: null,
    faithfulness: null
  }
];

describe("renderJsonReport", () => {
  it("round-trips the results plus an aggregate summary", () => {
    const json = JSON.parse(renderJsonReport(sample));
    expect(json.summary.meanRecall).toBe(1);
    expect(json.results).toHaveLength(1);
  });
});

describe("renderHtmlReport", () => {
  it("produces a self-contained HTML doc with the question and refs", () => {
    const html = renderHtmlReport(sample);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("What does John 3:16 say?");
    expect(html).toContain("John 3:16");
    expect(html).toContain("#365f7e");           // accent palette inlined
    expect(html).not.toContain("<script src");   // no external JS
  });

  it("escapes HTML-special characters in question text", () => {
    const html = renderHtmlReport([
      { ...sample[0], item: { ...sample[0].item, question: "love & <faith>" } }
    ]);
    expect(html).toContain("love &amp; &lt;faith&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eval/report.test.ts`
Expected: FAIL — cannot resolve `@/eval/report`.

- [ ] **Step 3: Write the implementation**

```typescript
// eval/report.ts
import { aggregate, type Aggregate } from "@/eval/metrics";
import { THRESHOLDS } from "@/eval/thresholds";
import { canonicalizeReference } from "@/eval/references";
import type { RunResult } from "@/eval/runner";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function summaryOf(results: RunResult[]): Aggregate {
  return aggregate(results.map((r) => ({ recall: r.recall, precision: r.precision, grounded: r.grounded })));
}

export function renderJsonReport(results: RunResult[]): string {
  return JSON.stringify(
    { generatedAt: new Date().toISOString(), thresholds: THRESHOLDS, summary: summaryOf(results), results },
    null,
    2
  );
}

function badge(pass: boolean): string {
  return pass
    ? `<span class="badge pass">PASS</span>`
    : `<span class="badge fail">FAIL</span>`;
}

function refDiff(result: RunResult): string {
  const golden = new Set(result.item.goldenReferences.map((r) => canonicalizeReference(r) ?? r));
  const retrieved = new Set(result.retrievedReferences.map((r) => canonicalizeReference(r) ?? r));
  const goldenRows = [...golden]
    .map((ref) => `<li class="${retrieved.has(ref) ? "hit" : "miss"}">${retrieved.has(ref) ? "✓" : "✗"} ${esc(ref)}</li>`)
    .join("");
  const retrievedRows = [...retrieved]
    .map((ref) => `<li class="${golden.has(ref) ? "hit" : "extra"}">${golden.has(ref) ? "✓" : "•"} ${esc(ref)}</li>`)
    .join("");
  return `<div class="refcols">
    <div><h4>Golden (${golden.size})</h4><ul>${goldenRows}</ul></div>
    <div><h4>Retrieved (${retrieved.size})</h4><ul>${retrievedRows}</ul></div>
  </div>`;
}

function traceRows(result: RunResult): string {
  if (result.hits.length === 0) return `<p class="muted">No citations retrieved.</p>`;
  const rows = result.hits
    .map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.reference)}</td><td>${esc(h.corpus)}</td><td>${esc(h.toolName ?? "")}</td></tr>`)
    .join("");
  return `<table class="trace"><thead><tr><th>#</th><th>Reference</th><th>Corpus</th><th>Tool</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function faithfulnessBlock(result: RunResult): string {
  if (!result.faithfulness) return "";
  const claims = result.faithfulness.claims
    .map((c) => `<li class="${c.supported ? "hit" : "miss"}">${c.supported ? "✓" : "✗"} ${esc(c.statement)} <span class="muted">— ${esc(c.reason)}</span></li>`)
    .join("");
  return `<div class="faith"><h4>Faithfulness ${result.faithfulness.score.toFixed(2)}</h4><ul>${claims}</ul></div>`;
}

function card(result: RunResult): string {
  const pass = result.recall >= THRESHOLDS.minRecall && result.grounded;
  return `<details class="card" ${pass ? "" : "open"}>
    <summary><span class="qt">${esc(result.item.queryType)}</span> ${esc(result.item.question)} ${badge(pass)}
      <span class="metric">R ${result.recall.toFixed(2)} · P ${result.precision.toFixed(2)}</span></summary>
    ${refDiff(result)}
    <h4>Retrieval trace</h4>
    ${traceRows(result)}
    ${faithfulnessBlock(result)}
  </details>`;
}

export function renderHtmlReport(results: RunResult[]): string {
  const s = summaryOf(results);
  const scoreRow = (label: string, value: number, threshold: number) =>
    `<tr><td>${label}</td><td>${value.toFixed(3)}</td><td>${threshold}</td><td>${badge(value >= threshold)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TextLab Eval Report</title>
<style>
  :root { --bg:#f6f5f1; --ink:#1f2933; --surface:#fff; --muted:#6b7280; --border:#d7d3ca; --accent:#365f7e; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Inter Tight", system-ui, sans-serif; line-height:1.5; padding:2rem; }
  h1, h2, h3 { font-family:"Spectral", Georgia, serif; }
  .accent-rule { border-left:3px solid var(--accent); padding-left:.75rem; }
  table { border-collapse:collapse; width:100%; background:var(--surface); }
  th, td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--border); }
  .badge { font-size:.7rem; font-weight:600; padding:.1rem .45rem; border-radius:3px; }
  .badge.pass { background:#e3efe5; color:#1d6b3a; }
  .badge.fail { background:#f5e0e0; color:#9b2c2c; }
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
  <p class="muted">Generated ${esc(new Date().toISOString())} · ${results.length} questions</p>
  <h2>Summary</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th><th>Threshold</th><th>Status</th></tr></thead>
    <tbody>
      ${scoreRow("Mean Context Recall", s.meanRecall, THRESHOLDS.meanRecall)}
      ${scoreRow("Mean Context Precision", s.meanPrecision, THRESHOLDS.meanPrecision)}
      ${scoreRow("Grounding pass-rate", s.groundingPassRate, THRESHOLDS.groundingPassRate)}
      ${scoreRow("Per-question recall floor", s.minRecall, THRESHOLDS.minRecall)}
    </tbody>
  </table>
  <h2>Questions</h2>
  ${results.map(card).join("\n")}
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eval/report.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add eval/report.ts tests/unit/eval/report.test.ts
git commit -m "Add self-contained HTML + JSON eval report renderer"
```

---

## Task 9: Gate script + npm script

**Files:**
- Create: `scripts/eval-gate.ts`
- Modify: `package.json:5-26` (add `eval:gate`)
- Create: `.gitignore` entry for `eval/output/`

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
  for (const item of items) {
    results.push(await runDeterministic(item));
  }

  const agg = aggregate(results.map((r) => ({ recall: r.recall, precision: r.precision, grounded: r.grounded })));

  const checks = [
    { label: "Mean Context Recall", value: agg.meanRecall, min: THRESHOLDS.meanRecall },
    { label: "Mean Context Precision", value: agg.meanPrecision, min: THRESHOLDS.meanPrecision },
    { label: "Grounding pass-rate", value: agg.groundingPassRate, min: THRESHOLDS.groundingPassRate },
    { label: "Per-question recall floor", value: agg.minRecall, min: THRESHOLDS.minRecall }
  ];

  console.log(`\nTextLab eval gate — ${results.length} questions\n`);
  let failed = false;
  for (const c of checks) {
    const ok = c.value >= c.min;
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.label}: ${c.value.toFixed(3)} (>= ${c.min})`);
  }

  // Name the worst per-question offenders so a failure is actionable.
  const worst = [...results].sort((a, b) => a.recall - b.recall).slice(0, 3);
  console.log("\nLowest-recall questions:");
  for (const r of worst) {
    console.log(`  ${r.recall.toFixed(2)}  ${r.item.id} — ${r.item.question}`);
  }

  if (failed) {
    console.error("\nEval gate FAILED.\n");
    process.exit(1);
  }
  console.log("\nEval gate passed.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts block, after `"embed:verses"`, add:

```json
    "eval:gate": "tsx --env-file=.env.test scripts/eval-gate.ts",
```

(Remember the trailing comma on the previous line.)

- [ ] **Step 3: Ignore generated output**

Add to `.gitignore` (create the entry if absent):

```
eval/output/
```

- [ ] **Step 4: Run the gate against the test DB**

Run: `npm run eval:gate`
Expected: it executes all questions and prints per-metric PASS/FAIL. It MAY fail on the draft thresholds — that is fine at this step; Task 11 calibrates. What matters here: it runs end-to-end with no crash and no API key.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-gate.ts package.json .gitignore
git commit -m "Add deterministic eval:gate script"
```

---

## Task 10: Report script + npm script

**Files:**
- Create: `scripts/eval-report.ts`
- Modify: `package.json` (add `eval:report`)

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
  const liveJudge = Boolean(process.env.OPENAI_API_KEY);
  console.log(`Running ${items.length} questions (faithfulness judge: ${liveJudge ? "on" : "off — no OPENAI_API_KEY"})`);

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts block, after `"eval:gate"`, add:

```json
    "eval:report": "tsx --env-file=.env.test scripts/eval-report.ts",
```

> The report uses `.env.test` for `DATABASE_URL`. Faithfulness runs only if `OPENAI_API_KEY` is present in the process env (system env or `.env.test`); without it, the report still renders with retrieval + grounding only.

- [ ] **Step 3: Run the report**

Run: `npm run eval:report`
Expected: writes `eval/output/report.html` + `report.json`. Open the HTML in a browser and confirm the scorecard + collapsible per-question cards render with the editorial palette.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-report.ts package.json
git commit -m "Add eval:report script writing HTML + JSON dashboard"
```

---

## Task 11: Calibrate thresholds against the first real run

**Files:**
- Modify: `eval/thresholds.ts`

> Do this only AFTER the maintainer has reviewed/approved the golden set (Task 5 checkpoint), so calibration reflects a trusted dataset.

- [ ] **Step 1: Capture the baseline**

Run: `npm run eval:gate`
Read the printed mean recall, mean precision, and min recall.

- [ ] **Step 2: Investigate any low scorer before lowering a threshold**

If `npm run eval:gate` fails, FIRST run `npm run eval:report`, open `eval/output/report.html`, and inspect the lowest-recall cards' golden-vs-retrieved diff and retrieval trace. Decide per case:
- **Golden set is wrong** (a listed verse isn't really expected, or a real hit is missing) → fix `golden-set.json` and re-run. This is the common case for the domain items flagged "VERIFY during review".
- **Pipeline genuinely misses** → that is a real finding; record it. Set the threshold just below the achieved baseline so the gate is green, and note the gap as a follow-up to ratchet up later.

- [ ] **Step 3: Set thresholds to lock in the achieved baseline (minus a small margin)**

Edit `eval/thresholds.ts` so each threshold is at or just below the observed value (round to 2 decimals), keeping `groundingPassRate: 1`. Example if the run yields recall 0.94 / precision 0.86 / min-recall 0.67:

```typescript
export const THRESHOLDS = {
  meanRecall: 0.92,
  meanPrecision: 0.85,
  groundingPassRate: 1,
  minRecall: 0.6
} as const;
```

- [ ] **Step 4: Confirm green + thresholds test still valid**

Run: `npm run eval:gate` → expect exit 0.
Run: `npx vitest run tests/unit/eval/thresholds.test.ts` → expect PASS (minRecall ≤ meanRecall still holds).

- [ ] **Step 5: Commit**

```bash
git add eval/thresholds.ts
git commit -m "Calibrate eval gate thresholds to first-run baseline"
```

---

## Task 12: Integration smoke test for the runner

**Files:**
- Create: `tests/integration/eval-runner.test.ts`

- [ ] **Step 1: Confirm the integration test pattern**

Read an existing file under `tests/integration/` (e.g. `tests/integration/fts-search.test.ts`) to copy the exact `DATABASE_URL`-guard / skip idiom and import style used there. Mirror it — do not invent a different skip mechanism.

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
    expect(result.grounded).toBe(true);
    expect(typeof result.precision).toBe("number");
  }, 30_000);
});
```

> If `describe.runIf` is not the idiom the existing integration tests use, match whatever they do (e.g. a top-level `if (!hasDb) return` or `it.skip`). The existing files are the source of truth.

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration`
Expected: the new test PASSES against the Neon test branch (and the existing integration tests stay green).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/eval-runner.test.ts
git commit -m "Add eval-runner integration smoke test"
```

---

## Task 13: Wire the gate into verification + docs

**Files:**
- Modify: `package.json` (extend `verify` or document `eval:gate` as a CI step)
- Modify: `README.md`
- Modify: `docs/PROJECT_STATE.md`
- Modify: `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: Decide gate wiring**

The current `verify` script (`package.json:15`) is `lint && tsc && build && test:coverage` and does NOT require a DB. `eval:gate` needs `DATABASE_URL` (Neon test branch). Do NOT fold `eval:gate` into `verify` (it would make the DB-free `verify` require a DB). Instead, add it as a separate documented CI step alongside `test:integration` and `test:acceptance`, which also need the DB.

- [ ] **Step 2: Update README**

Add an "Evaluation harness" subsection documenting:
- `npm run eval:gate` — deterministic, DB-only, blocking PR gate (Context Precision/Recall + grounding). Lives in `eval/`, dataset at `eval/dataset/golden-set.json`.
- `npm run eval:report` — nightly/on-demand; adds LLM-as-judge faithfulness when `OPENAI_API_KEY` is set; writes `eval/output/report.html` + `report.json`.
- That the gate runs in CI alongside `test:integration` / `test:acceptance`.

- [ ] **Step 3: Update PROJECT_STATE.md**

- Move Phase 6 from pending to ✅ done in the Milestone 3 section (lines ~215).
- Update the snapshot header (line 3) to mention Phase 6.
- Add a "Test surfaces" entry describing the eval harness (gate metrics, the calibrated thresholds, the dashboard, the golden set size + query-type coverage).
- Note that the prose-sweep grounding hardening (line ~172) remains an open follow-up (NOT closed by Phase 6).

- [ ] **Step 4: Update the roadmap**

In `docs/HiFi-exegesis-nt-roadmap.md`, mark Phase 6 (line ~247) ✅ done with a one-line summary of what shipped.

- [ ] **Step 5: Run full verification**

Run:
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
git commit -m "Document Phase 6 evaluation harness; mark phase done"
```

---

## Self-review notes (author)

- **Spec coverage:** dataset (T1,T5) · precision/recall (T3) · grounding pass-rate (T7 runner + T9 gate) · deterministic blocking gate + thresholds (T4,T9,T11) · LLM-judge faithfulness nightly (T6,T7,T10) · HTML+JSON dashboard with golden-vs-retrieved + trace (T8) · unit + integration tests (T2–T8,T12) · docs (T13). Out-of-scope items (prose-sweep grounding, branch-coverage gate, auto-derived questions) are not implemented, matching the spec.
- **Open items the implementer must resolve against the live codebase (flagged inline, not placeholders):** the exact `openai@4` `responses.create` option/output shape in `eval/judge.ts` (mirror `lib/ai/synthesis.ts`); the `openaiClient` export name; the integration-test skip idiom. Each task names the source-of-truth file to copy from.
- **Type consistency:** `RunResult` is defined once (T7) and consumed by `report.ts` (T8), `eval-gate.ts` (T9), `eval-report.ts` (T10), and the integration test (T12). `QuestionScore`/`Aggregate` defined in `metrics.ts` (T3) and reused in `report.ts`/`eval-gate.ts`. `THRESHOLDS` keys (`meanRecall`, `meanPrecision`, `groundingPassRate`, `minRecall`) are identical across `thresholds.ts`, its test, `report.ts`, and `eval-gate.ts`.
- **Domain golden sets** (`domain-ln-25-love`, `domain-88-moral-rom1`) carry explicit "VERIFY against seeded data" notes — calibration (T11) is where these get corrected against the real token codes.
