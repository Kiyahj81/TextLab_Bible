# Assistant Grounded, Question-Shaped Answers — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. If working in isolation, create a worktree first via superpowers:using-git-worktrees.

**Goal:** Make the assistant's answers shaped to the question and grounded in retrieved evidence (a grounded core; interpretation only when invited and only as a visible derivation), and make scholarly-model routing actually fire.

**Architecture:** Five threads over the existing retrieval-first pipeline: (1) enrich the evidence the synthesizer and judge both read with per-token morphology/gloss/Louw-Nida; (2) replace the hardcoded three-section synthesis prompt with intent-shaped guidance + a derivation-chain rule; (3) rewrite the deterministic fallback to a core-only shape; (4) replace the dead jargon-string scholarly detector with signal-based detection plus opt-in first-pass auto-escalation; (5) capture a manual faithfulness before/after (2A). No schema migration, no answer-rendering component change.

**Tech Stack:** Next.js 15 / React 19 / TypeScript 5.8 · Prisma 6 / PostgreSQL · OpenAI Node SDK v4 (`responses.create`) · Vitest 4 + Testing Library + jsdom · zod 3.

**Spec:** `docs/superpowers/specs/2026-06-26-assistant-dynamic-grounded-answers-design.md` (read it before starting).

## Global Constraints

- **No DB migration / no `db:push`.** This plan adds no columns; all data already exists on `Token`.
- **Coverage gate** (`vitest.config.ts`): v8 over `app/api/**` + `lib/**` at lines 80 / statements 80 / functions 75 / branches 65. New pure logic must carry unit tests; thin DB queries follow the existing integration-tested pattern in `lib/search/*`.
- **SBLGNT is the citation spine**; WEB is a display aid only. Enrichment is SBLGNT-only.
- **Don't lower eval/CI thresholds.** The deterministic eval gate is unaffected (it checks citation resolvability + lemma coverage, not prose shape).
- **Retain existing `SYNTHESIS_SYSTEM_PROMPT` rules**: exact-Greek-quote discipline, English-explanation-first / every-Greek-word-glossed, and the `claims[]` contract. (A unit test in `tests/unit/lib/ai/synthesis.test.ts` pins the Greek rules — keep it green.)
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verification commands** (run from repo root; npm scripts bake in `--use-system-ca`):
  - single unit file: `npx vitest run <path>` or `npm run test:unit -- <substr>`
  - lint: `npm run lint` · types: `npx tsc --noEmit --pretty false`
  - integration (needs `.env.test` Neon branch): `npm run test:integration -- <substr>`
  - full local gate: `npm run verify`
- `main` is protected (PR required); do not push to `main`. Work on a feature branch.

---

## Task 1: Pure token-annotation formatter

**Files:**
- Create: `lib/ai/passageEvidence.ts`
- Test: `tests/unit/lib/ai/passageEvidence.test.ts`

**Interfaces:**
- Consumes: `decodeMorphCode` from `@/lib/morphology` (returns `string | null`).
- Produces:
  - `type PassageToken = { surface: string; lemma: string | null; morphCode: string | null; partOfSpeech: string | null; gloss: string | null; domainLabel: string | null }`
  - `formatTokenAnnotations(tokens: PassageToken[], opts?: { contentOnly?: boolean; targetLemmas?: ReadonlySet<string> }): string[]` — one indented annotation line per kept token.
  - `ANNOTATION_SKIP_POS` constant.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/ai/passageEvidence.test.ts
import { describe, expect, it } from "vitest";
import { formatTokenAnnotations, type PassageToken } from "@/lib/ai/passageEvidence";

const tok = (over: Partial<PassageToken>): PassageToken => ({
  surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM",
  partOfSpeech: "N-", gloss: "word", domainLabel: "Communication (33)", ...over
});

describe("formatTokenAnnotations", () => {
  it("renders surface · lemma · decoded morph · gloss · domain", () => {
    const [line] = formatTokenAnnotations([tok({})]);
    expect(line).toBe('    λόγος · λόγος · noun nominative singular masculine · "word" · Communication (33)');
  });

  it("omits absent fields rather than placeholdering them", () => {
    const [line] = formatTokenAnnotations([tok({ gloss: null, domainLabel: null, morphCode: null })]);
    expect(line).toBe("    λόγος · λόγος");
  });

  it("skips article/conjunction/particle when contentOnly", () => {
    const lines = formatTokenAnnotations(
      [tok({ surface: "ὁ", lemma: "ὁ", partOfSpeech: "RA" }), tok({})],
      { contentOnly: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("λόγος");
  });

  it("keeps a stoplist token when it is a query target lemma", () => {
    const lines = formatTokenAnnotations(
      [tok({ surface: "καί", lemma: "καί", partOfSpeech: "C-" })],
      { contentOnly: true, targetLemmas: new Set(["καί"]) }
    );
    expect(lines).toHaveLength(1);
  });

  it("keeps function words when contentOnly is false (morphology intent)", () => {
    const lines = formatTokenAnnotations([tok({ partOfSpeech: "C-" })], { contentOnly: false });
    expect(lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/ai/passageEvidence.test.ts`
Expected: FAIL — `Cannot find module "@/lib/ai/passageEvidence"`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// lib/ai/passageEvidence.ts
import { decodeMorphCode } from "@/lib/morphology";

export type PassageToken = {
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  partOfSpeech: string | null;
  gloss: string | null;
  domainLabel: string | null;
};

// Skip articles, conjunctions, and particles by default. These are the stored
// 2-char Token.partOfSpeech values (see lib/morphology.ts POS_LABELS).
export const ANNOTATION_SKIP_POS: readonly string[] = ["RA", "C-", "X-"];

function isContentToken(t: PassageToken, targetLemmas?: ReadonlySet<string>): boolean {
  if (t.lemma && targetLemmas?.has(t.lemma)) return true; // always keep query targets
  return !ANNOTATION_SKIP_POS.includes(t.partOfSpeech ?? "");
}

// One indented "surface · lemma · decoded morph · "gloss" · domain" line per kept
// token; every field after surface is included only when present.
export function formatTokenAnnotations(
  tokens: PassageToken[],
  opts: { contentOnly?: boolean; targetLemmas?: ReadonlySet<string> } = {}
): string[] {
  const contentOnly = opts.contentOnly ?? true;
  const lines: string[] = [];
  for (const t of tokens) {
    if (contentOnly && !isContentToken(t, opts.targetLemmas)) continue;
    const parts: string[] = [t.surface];
    if (t.lemma) parts.push(t.lemma);
    const decoded = t.morphCode ? decodeMorphCode(t.morphCode) : null;
    if (decoded) parts.push(decoded);
    if (t.gloss) parts.push(`"${t.gloss}"`);
    if (t.domainLabel) parts.push(t.domainLabel);
    lines.push(`    ${parts.join(" · ")}`);
  }
  return lines;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/ai/passageEvidence.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/passageEvidence.ts tests/unit/lib/ai/passageEvidence.test.ts
git commit -m "feat(assistant): pure token-annotation formatter for passage evidence" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `getPassageTokens` query (SBLGNT, verse-range)

**Files:**
- Modify: `lib/search/reader.ts` (add `getPassageTokens`)
- Modify: `lib/search.ts` (re-export `getPassageTokens`)
- Test: `tests/integration/passage-tokens.test.ts`

**Interfaces:**
- Consumes: Prisma `token` / `louwNidaDomain` models; `normalizeBook` from `@/lib/references`; `PassageToken` from Task 1.
- Produces: `getPassageTokens(input: { book: string; chapter: number; verseStart: number; verseEnd: number }): Promise<PassageTokenRow[]>` where `type PassageTokenRow = PassageToken & { verse: number; wordIndex: number }`, ordered by `verse` then `wordIndex`.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/passage-tokens.test.ts
import { describe, expect, it } from "vitest";
import { getPassageTokens } from "@/lib/search";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const d = dbConfigured ? describe : describe.skip;

d("getPassageTokens (integration)", () => {
  it("returns enriched SBLGNT tokens for John 1:1 in word order", async () => {
    const rows = await getPassageTokens({ book: "John", chapter: 1, verseStart: 1, verseEnd: 1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.verse === 1)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i].wordIndex).toBeGreaterThanOrEqual(rows[i - 1].wordIndex);
    const logos = rows.find((r) => r.lemma === "λόγος");
    expect(logos?.surface).toBeTruthy();
    expect(logos?.morphCode).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- passage-tokens`
Expected: FAIL — `getPassageTokens` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `lib/search/reader.ts` (reuse the domain-label resolution already used by `getReaderPassage`):

```ts
import type { PassageToken } from "@/lib/ai/passageEvidence";

export type PassageTokenRow = PassageToken & { verse: number; wordIndex: number };

// Enriched SBLGNT tokens for a verse range — a trimmed getReaderPassage token path
// with no user notes/highlights, for the assistant's evidence block.
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
  const domainCodes = new Set<string>();
  for (const t of tokens) {
    const primary = t.lnDomain[0];
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
    const code = t.lnDomain[0]?.slice(0, 3);
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
```

Add the re-export in `lib/search.ts` next to the other reader exports:

```ts
export { getPassageTokens, type PassageTokenRow } from "@/lib/search/reader";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- passage-tokens`
Expected: PASS (skips cleanly if `.env.test` is unset; PASS when the seeded Neon branch is reachable).
Also run: `npx tsc --noEmit --pretty false` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/search/reader.ts lib/search.ts tests/integration/passage-tokens.test.ts
git commit -m "feat(search): getPassageTokens enriched verse-range token fetch" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Enrich `passageCall` evidence (span gate + deterministic total budget)

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts` (`passageCall`, `buildPlan`)
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts` (extend)

**Interfaces:**
- Consumes: `getPassageTokens` (Task 2), `formatTokenAnnotations` (Task 1), `Signals.intent` + `Signals.greekWords`.
- Produces: enriched `formattedEvidence` for SBLGNT passages — annotation lines beneath each verse line. Enrichment is gated: SBLGNT corpus **and** single-chapter **and** ≤ 25 fetched verses **and** within the first `MAX_ENRICHED_PASSAGES` passages of the plan (deterministic, race-free).

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/unit/lib/ai/retrievalPlanner.test.ts
// (this suite already mocks "@/lib/search"; add getPassageTokens to that mock)
it("annotates a ≤25-verse SBLGNT passage with per-token morphology/gloss", async () => {
  getPassage.mockResolvedValue({
    corpus: "SBLGNT",
    references: [{ book: "John", chapter: 1, verse: 1, reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος" }]
  });
  getPassageTokens.mockResolvedValue([
    { surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "N-", gloss: "word", domainLabel: "Communication (33)", verse: 1, wordIndex: 4 }
  ]);
  const signals = extractSignals("Show John 1:1");
  const packet = await runRetrievalPlan(signals, "Show John 1:1", false);
  expect(packet.formattedEvidence).toContain('λόγος · λόγος · noun nominative singular masculine · "word"');
});

it("does NOT annotate a >25-verse passage", async () => {
  const refs = Array.from({ length: 30 }, (_, i) => ({ book: "John", chapter: 1, verse: i + 1, reference: `John 1:${i + 1}`, text: "…" }));
  getPassage.mockResolvedValue({ corpus: "SBLGNT", references: refs });
  getPassageTokens.mockResolvedValue([]);
  const signals = extractSignals("Show John 1");
  await runRetrievalPlan(signals, "Show John 1", false);
  expect(getPassageTokens).not.toHaveBeenCalled();
});
```

Add `getPassageTokens` to the existing `vi.mock("@/lib/search", …)` hoisted mock object at the top of the file, and `getPassageTokens.mockReset()` in `beforeEach`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- retrievalPlanner`
Expected: FAIL — `getPassageTokens` not called / annotation text absent.

- [ ] **Step 3: Write the implementation**

In `lib/ai/retrievalPlanner.ts`:

```ts
// near the other imports
import { getPassageTokens, /* …existing… */ } from "@/lib/search";
import { formatTokenAnnotations } from "@/lib/ai/passageEvidence";

// near the other bound constants
const MAX_ENRICH_VERSES = 25;        // matches the project "long passage" threshold
const MAX_ENRICHED_PASSAGES = 3;     // deterministic total-enrichment budget (plan order)
```

Change `passageCall` to accept enrichment context and interleave annotation lines:

```ts
function passageCall(
  corpus: "SBLGNT" | "WEB",
  ref: ParsedReference,
  enrich: { enabled: boolean; contentOnly: boolean; targetLemmas: ReadonlySet<string> }
): PlannedCall {
  const segments = passageSegments(ref);
  const crossChapter = ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter;
  // …unchanged label/key/errorTrace…
  return {
    key: /* unchanged */,
    errorTrace: /* unchanged */,
    run: async () => {
      // …unchanged fetch loop producing `all`, `shown`, `citations`, `traces`, `truncatedByCeiling`…

      // Enrich only a small, single-chapter SBLGNT passage; deterministic + race-free.
      const canEnrich =
        corpus === "SBLGNT" && enrich.enabled && !crossChapter && all.length > 0 && all.length <= MAX_ENRICH_VERSES;
      const annotationsByVerse = new Map<number, string[]>();
      if (canEnrich) {
        const first = shown[0].verse;
        const last = shown[shown.length - 1].verse;
        const tokens = await getPassageTokens({ book: ref.book, chapter: ref.chapter, verseStart: first, verseEnd: last });
        for (const t of tokens) {
          const [line] = formatTokenAnnotations([t], { contentOnly: enrich.contentOnly, targetLemmas: enrich.targetLemmas });
          if (!line) continue;
          const list = annotationsByVerse.get(t.verse) ?? [];
          list.push(line);
          annotationsByVerse.set(t.verse, list);
        }
      }

      const lines = shown.flatMap((r) => {
        const base = `- ${r.reference}, ${corpus}: ${r.text}`;
        const ann = annotationsByVerse.get(r.verse) ?? [];
        return ann.length ? [base, ...ann] : [base];
      });

      const heading = `getPassage(${label}, ${corpus})`;
      const section = truncatedByCeiling
        ? `### ${heading}\n${lines.join("\n")}\n…(truncated at ${MAX_PASSAGE_LINES}-line ceiling; request a narrower range for the full passage)`
        : sectionBlock(heading, lines, all.length);
      return { citations, section, traces };
    }
  };
}
```

In `buildPlan`, pass the deterministic budget + intent context as each SBLGNT passage is added:

```ts
const targetLemmas = new Set(signals.greekWords);
const contentOnly = signals.intent !== "morphology";
let enrichedPassages = 0;
for (const ref of signals.references) {
  const enabled = enrichedPassages < MAX_ENRICHED_PASSAGES;
  add(passageCall("SBLGNT", ref, { enabled, contentOnly, targetLemmas }));
  if (enabled) enrichedPassages++;
  add(passageCall("WEB", ref, { enabled: false, contentOnly, targetLemmas }));
}
```

(Remove the old `for (const ref …) { add(passageCall("SBLGNT", ref)); add(passageCall("WEB", ref)); }` loop.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- retrievalPlanner`
Expected: PASS — including the two new cases and all pre-existing scoping/budget tests.
Run: `npx tsc --noEmit --pretty false` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "feat(assistant): enrich passage evidence with per-token morphology/gloss/domain" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Decoded morphology + gloss on word/lemma/domain evidence

**Files:**
- Modify: `lib/search/shared.ts` (`HydratedToken`, `hydrateTokens` output)
- Modify: `lib/search/tokens.ts`, `lib/search/domain.ts` (include `gloss` + `partOfSpeech` in the `findMany`)
- Modify: `lib/ai/retrievalPlanner.ts` (`lemmaCall`, `domainCall`, `morphCall` evidence lines)
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts` (extend); `tests/integration/fts-search.test.ts` or `louw-nida-search.test.ts` (assert `gloss` present)

**Interfaces:**
- Consumes: `decodeMorphCode` from `@/lib/morphology`.
- Produces: each hydrated search row gains `gloss: string | null`. Evidence table rows for lemma/domain searches read `| ref | surface | <decoded morph> | "gloss" | verseText |`; morphology rows read `| ref | surface | lemma | <decoded morph> |`.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/unit/lib/ai/retrievalPlanner.test.ts
it("decodes the morph code and appends the gloss on lemma evidence", async () => {
  searchLemma.mockResolvedValue({
    lemma: "λόγος", count: 1,
    results: [{ reference: "John 1:1", surface: "λόγος", morphCode: "N-NSM", gloss: "word", verseText: "Ἐν ἀρχῇ…", corpus: "SBLGNT", tokenId: "t1" }],
    pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 }
  });
  const signals = extractSignals("How is λόγος used?");
  const packet = await runRetrievalPlan(signals, "How is λόγος used?", false);
  expect(packet.formattedEvidence).toContain("noun nominative singular masculine");
  expect(packet.formattedEvidence).toContain('"word"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- retrievalPlanner`
Expected: FAIL — evidence still shows the raw `N-NSM` and no gloss.

- [ ] **Step 3: Write the implementation**

In `lib/search/shared.ts`, extend the hydrated type + mapping:

```ts
export type HydratedToken = {
  id: string;
  surface: string;
  lemma: string | null;
  morphCode: string | null;
  gloss: string | null;          // added
  chapter: number;
  verse: number;
  book: { id: string; osisId: string };
  corpus: { abbreviation: string };
};
```

In the `hydrateTokens` return mapping, add `gloss: token.gloss ?? null,` (alongside `lemma`, `morphCode`).

In `lib/search/tokens.ts` and `lib/search/domain.ts`, ensure the `prisma.token.findMany({ include: { book: true, corpus: true } })` also selects `gloss`. The default `findMany` already returns scalar columns including `gloss`; only the `include` is explicit, so **no query change is required** — but add an explicit assertion comment to keep it intentional:

```ts
// `gloss` is a scalar column returned by default; surfaced via hydrateTokens for evidence.
```

In `lib/ai/retrievalPlanner.ts`, update the three evidence-line builders to decode morph + append gloss:

```ts
import { decodeMorphCode } from "@/lib/morphology";

// lemmaCall.run() lines:
const lines = res.results.slice(0, MAX_WORD_SAMPLE).map((r) => {
  const morph = r.morphCode ? decodeMorphCode(r.morphCode) ?? r.morphCode : "";
  const gloss = r.gloss ? ` "${r.gloss}"` : "";
  return `| ${r.reference} | ${r.surface} | ${morph}${gloss} | ${r.verseText} |`;
});

// domainCall.run() lines: identical shape to lemmaCall above.

// morphCall.run() lines:
const lines = res.results.slice(0, MAX_WORD_SAMPLE).map((r) => {
  const morph = r.morphCode ? decodeMorphCode(r.morphCode) ?? r.morphCode : "";
  return `| ${r.reference} | ${r.surface} | ${r.lemma} | ${morph} |`;
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- retrievalPlanner`
Expected: PASS.
Run: `npx tsc --noEmit --pretty false` → no errors. (If any test constructs hydrated rows without `gloss`, add `gloss: null`.)

- [ ] **Step 5: Commit**

```bash
git add lib/search/shared.ts lib/search/tokens.ts lib/search/domain.ts lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "feat(assistant): decoded morphology + gloss on word-search evidence" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Intent-shaped synthesis prompt + derivation chain

**Files:**
- Modify: `lib/ai/synthesis.ts` (`SYNTHESIS_SYSTEM_PROMPT`, add `INTENT_SHAPE_GUIDANCE` + `buildSynthesisInstructions`, `SynthesisInput.intent`, both `responses.create` calls)
- Modify: `lib/ai/assistant.ts` (pass `signals.intent` into `synthesizeWithRefinement`)
- Test: `tests/unit/lib/ai/synthesis.test.ts` (extend)

**Interfaces:**
- Consumes: `Intent` type from `@/lib/ai/signals`.
- Produces: `buildSynthesisInstructions(intent: Intent): string`; `SynthesisInput` gains `intent?: Intent` (default `"general"`). `SYNTHESIS_SYSTEM_PROMPT` no longer mentions "three sections"; it states the derivation-chain rule + lexical guardrails.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/unit/lib/ai/synthesis.test.ts
describe("buildSynthesisInstructions", () => {
  it("states the grounded-core / going-further derivation rule and retrieved-only guardrail", async () => {
    const { buildSynthesisInstructions } = await import("@/lib/ai/synthesis");
    const text = buildSynthesisInstructions("passage-study");
    expect(text).toContain("grounded core");
    expect(text).toContain("Going further");
    expect(text).toContain("retrieved evidence");           // retrieved-only synthesis
    expect(text).not.toContain("Structure the answer in three sections");
  });

  it("tells morphology answers to stay technical with no application", async () => {
    const { buildSynthesisInstructions } = await import("@/lib/ai/synthesis");
    expect(buildSynthesisInstructions("morphology").toLowerCase()).toContain("no application");
  });
});
```

Keep the existing `SYNTHESIS_SYSTEM_PROMPT` Greek-rules test (it must still pass — those rules stay in the base prompt).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- synthesis`
Expected: FAIL — `buildSynthesisInstructions` not exported.

- [ ] **Step 3: Write the implementation**

In `lib/ai/synthesis.ts`:

```ts
import type { Intent } from "@/lib/ai/signals";
```

Replace the "Structure the answer in three sections … 3. Application/reflection" block in `SYNTHESIS_SYSTEM_PROMPT` with the derivation-chain rule + guardrails (keep every other rule — Greek quoting, English gloss, claims — unchanged):

```
Write a grounded core from the retrieved evidence first: what the text says, plus
lexical/grammatical observations supported by the provided morphology, glosses, and
Louw-Nida domains. You may then add a section headed "Going further" with interpretation
or application — but ONLY when the question invites it, and every such statement must
explicitly build on a stated observation from the core. Do not make leaps disconnected
from the evidence.

Grounding rules:
- Use ONLY the retrieved evidence. No cross-references or doctrine that are not in the
  retrieved evidence. Connecting retrieved passages is encouraged; importing unretrieved
  ones is not.
- Do not overclaim from metadata: a Louw-Nida domain label is a broad orienting category,
  not proof; a gloss is one context-limited English aid — say "the gloss given is …",
  not "the word means …".
- Mention only morphology/gloss/domain fields actually present in the evidence; never
  infer or invent them.
```

Add the per-intent guidance map + builder:

```ts
const INTENT_SHAPE_GUIDANCE: Record<Intent, string> = {
  "morphology":
    "Shape: concise and technical. Lead with the parse/forms. No application or reflection.",
  "passage-study":
    "Shape: medium. State what the passage says with its key grounded lexical observations, then the meaning. Add 'Going further' only if the question asks for significance/application.",
  "word-study":
    "Shape: medium. Survey the occurrences and their senses from the evidence. Rarely add 'Going further'.",
  "topic-survey":
    "Shape: medium. Present the retrieved passages and the thread connecting THEM (no imported passages). Add 'Going further' if the question invites it.",
  "comparison":
    "Shape: medium. Compare side by side; assert only contrasts the evidence supports. Add 'Going further' if invited.",
  "general":
    "Shape: scale to the question. Brief for a lookup; fuller for an open question. Add 'Going further' only if invited."
};

export function buildSynthesisInstructions(intent: Intent = "general"): string {
  return `${SYNTHESIS_SYSTEM_PROMPT}\n\nFor this question:\n${INTENT_SHAPE_GUIDANCE[intent]}`;
}
```

Thread `intent` through:

```ts
type SynthesisInput = {
  prompt: string;
  evidence: EvidencePacket;
  routing: RoutingDecision;
  intent?: Intent;            // added
};
```

In `synthesizeWithRefinement`, destructure `intent` and use the builder for BOTH `responses.create` calls:

```ts
const { prompt, evidence, routing, intent = "general" } = input;
const instructions = buildSynthesisInstructions(intent);
// first call: instructions: instructions,
// second (refinement) call: instructions: instructions,
```

In `lib/ai/assistant.ts`, pass the intent already computed from `signals`:

```ts
const result = await synthesizeWithRefinement({ prompt, evidence, routing, intent: signals.intent });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- synthesis`
Expected: PASS — new `buildSynthesisInstructions` tests AND the retained Greek-rules test.
Run: `npx tsc --noEmit --pretty false` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/synthesis.ts lib/ai/assistant.ts tests/unit/lib/ai/synthesis.test.ts
git commit -m "feat(assistant): intent-shaped synthesis with derivation-chain rule" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Core-only deterministic fallback

**Files:**
- Modify: `lib/ai/synthesis.ts` (`buildDeterministicFallback`)
- Test: `tests/unit/lib/ai/synthesis.test.ts` (extend)

**Interfaces:**
- Consumes: `EvidencePacket`.
- Produces: a fallback string that presents the retrieved evidence as a grounded core with no "Interpretive suggestion" / "Application/reflection" sections.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/unit/lib/ai/synthesis.test.ts
describe("buildDeterministicFallback", () => {
  it("returns a grounded core with no forced interpretation/application sections", async () => {
    const { buildDeterministicFallback } = await import("@/lib/ai/synthesis");
    const text = buildDeterministicFallback("What does John 1:1 say?", evidence);
    expect(text).toContain(evidence.formattedEvidence);
    expect(text).not.toContain("Interpretive suggestion");
    expect(text).not.toContain("Application/reflection");
  });

  it("guides a rephrase when no evidence was retrieved", async () => {
    const { buildDeterministicFallback } = await import("@/lib/ai/synthesis");
    const empty = { citations: [], toolTrace: [], formattedEvidence: "No retrieval signals produced evidence from the corpus." };
    expect(buildDeterministicFallback("xyz", empty).toLowerCase()).toContain("rephras");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- synthesis`
Expected: FAIL — current output still contains "Interpretive suggestion"/"Application/reflection".

- [ ] **Step 3: Write the implementation**

Replace `buildDeterministicFallback` in `lib/ai/synthesis.ts`:

```ts
export function buildDeterministicFallback(prompt: string, evidence: EvidencePacket): string {
  const hasEvidence = evidence.citations.length > 0;
  const header = `Grounded evidence TextLab retrieved for "${prompt.trim()}":`;
  const footer = hasEvidence
    ? "These are the cited occurrences from the corpus; treat them as the basis for any further study."
    : "No corpus evidence matched. Try rephrasing around a specific passage, Greek word, or reference so TextLab can retrieve supporting text.";
  return [header, "", evidence.formattedEvidence, "", footer].join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- synthesis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/synthesis.ts tests/unit/lib/ai/synthesis.test.ts
git commit -m "feat(assistant): core-only deterministic fallback (drop forced sections)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Signal-based scholarly detection

**Files:**
- Modify: `lib/ai/modelRouter.ts` (`recommendScholarlyUpgrade` now takes `Signals`)
- Test: `tests/unit/lib/ai/modelRouter.test.ts` (update + extend)

**Interfaces:**
- Consumes: `Signals` from `@/lib/ai/signals`.
- Produces: `recommendScholarlyUpgrade(prompt: string, signals?: Signals): RecommendedUpgrade | undefined` — fires on comparison intent, ≥2 distinct reference books, tension/synthesis framing, ≥3 distinct topic words, long prompts, or an explicit cue.

- [ ] **Step 1: Write the failing test**

```ts
// replace the existing recommendScholarlyUpgrade describe-block with:
import { extractSignals } from "@/lib/ai/signals";

describe("recommendScholarlyUpgrade", () => {
  const rec = (p: string) => recommendScholarlyUpgrade(p, extractSignals(p));

  it("returns undefined for a simple lookup", () => {
    expect(rec("What does John 1:1 say?")).toBeUndefined();
  });

  it("recommends scholarly for cross-book tension questions", () => {
    expect(rec("How do Paul in Romans and James reconcile faith and works?")?.modelRole).toBe("scholarly");
  });

  it("recommends scholarly for a comparison prompt", () => {
    expect(rec("Compare δικαιοσύνη in Romans and Galatians")?.modelRole).toBe("scholarly");
  });

  it("still honors an explicit scholarly cue", () => {
    expect(rec("Give a deep synthesis of atonement")?.modelRole).toBe("scholarly");
  });
});
```

Also update the existing `routeAssistantPrompt` "attaches an advisory scholarly upgrade" test if it relied on a bare jargon string (use `extractSignals` to pass signals — see Task 8).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- modelRouter`
Expected: FAIL — the cross-book/comparison prompts currently return undefined.

- [ ] **Step 3: Write the implementation**

Replace `recommendScholarlyUpgrade` in `lib/ai/modelRouter.ts`:

```ts
import type { Signals } from "@/lib/ai/signals";

const SCHOLARLY_CUE_RE =
  /\b(scholarly|deep synthesis|theological nuance|interpretive options|reconcile|reconciliation between|tension|paradox|harmoniz)/i;
const HOW_CAN_BOTH_RE = /\bhow (can|do|does)\b[\s\S]{0,60}\band\b/i;

export function recommendScholarlyUpgrade(prompt: string, signals?: Signals): RecommendedUpgrade | undefined {
  const distinctBooks = new Set((signals?.references ?? []).map((r) => r.book)).size;
  const topicCount = signals?.topicWords.length ?? 0;
  const longPrompt = prompt.trim().split(/\s+/).length > 30;

  const complex =
    signals?.intent === "comparison" ||
    distinctBooks >= 2 ||
    SCHOLARLY_CUE_RE.test(prompt) ||
    HOW_CAN_BOTH_RE.test(prompt) ||
    topicCount >= 3 ||
    longPrompt;

  if (!complex) return undefined;
  return {
    modelRole: "scholarly",
    model: getModelForRole("scholarly"),
    reason: "This question looks like it needs deeper, cross-text synthesis; confirm before using the scholarly model."
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- modelRouter`
Expected: PASS.
Run: `npx tsc --noEmit --pretty false` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/modelRouter.ts tests/unit/lib/ai/modelRouter.test.ts
git commit -m "feat(assistant): signal-based scholarly detection" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Opt-in first-pass auto-escalation (routing + API)

**Files:**
- Modify: `lib/ai/modelRouter.ts` (`routeAssistantPrompt` options)
- Modify: `lib/ai/assistant.ts` (`answerBibleQuestion` threads signals + `autoEscalate`)
- Modify: `app/api/assistant/route.ts` (accept `autoEscalate`)
- Test: `tests/unit/lib/ai/modelRouter.test.ts`, `tests/unit/lib/ai/assistant.test.ts`, `tests/unit/api/assistant-route.test.ts`

**Interfaces:**
- Consumes: `recommendScholarlyUpgrade(prompt, signals)` (Task 7), `Signals`.
- Produces:
  - `routeAssistantPrompt(prompt: string, options?: { escalate?: boolean; autoEscalate?: boolean; signals?: Signals }): RoutingDecision`
  - `answerBibleQuestion(prompt, options?: { escalate?: boolean; autoEscalate?: boolean })`
  - API body accepts `autoEscalate?: boolean`.
  - Routing precedence: manual `escalate` → scholarly; else `autoEscalate && recommendation` → scholarly (first pass); else default + `recommendedUpgrade`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/ai/modelRouter.test.ts
import { extractSignals } from "@/lib/ai/signals";

it("auto-escalates on the first pass when autoEscalate is on and the prompt is complex", () => {
  const prompt = "How do Paul in Romans and James reconcile faith and works?";
  const decision = routeAssistantPrompt(prompt, { autoEscalate: true, signals: extractSignals(prompt) });
  expect(decision.modelRole).toBe("scholarly");
});

it("does NOT auto-escalate a simple prompt even when autoEscalate is on", () => {
  const prompt = "What does John 1:1 say?";
  const decision = routeAssistantPrompt(prompt, { autoEscalate: true, signals: extractSignals(prompt) });
  expect(decision.modelRole).toBe("default");
});

it("manual escalate still wins regardless of complexity", () => {
  const decision = routeAssistantPrompt("Show Romans 7", { escalate: true });
  expect(decision.modelRole).toBe("scholarly");
});
```

Update the earlier `routeAssistantPrompt` tests: the escalate case becomes `routeAssistantPrompt("Give a scholarly analysis", { escalate: true })`; the advisory case passes `{ signals: extractSignals(prompt) }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- modelRouter`
Expected: FAIL — options object not supported; auto-escalation absent.

- [ ] **Step 3: Write the implementation**

Replace `routeAssistantPrompt` in `lib/ai/modelRouter.ts`:

```ts
export function routeAssistantPrompt(
  prompt: string,
  options: { escalate?: boolean; autoEscalate?: boolean; signals?: Signals } = {}
): RoutingDecision {
  const { escalate = false, autoEscalate = false, signals } = options;

  if (escalate) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      routingDecision: "Escalated to the scholarly model at the user's request."
    };
  }

  const recommendedUpgrade = recommendScholarlyUpgrade(prompt, signals);

  if (autoEscalate && recommendedUpgrade) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      routingDecision: "Auto-escalated to the scholarly model (auto-scholarly is on and this question looks complex)."
    };
  }

  return {
    modelRole: "default",
    modelUsed: getModelForRole("default"),
    routingDecision: recommendedUpgrade
      ? "Handled by the default model; scholarly mode is available on user-confirmed escalation."
      : "Handled by the default model for normal retrieval planning and synthesis.",
    recommendedUpgrade
  };
}
```

In `lib/ai/assistant.ts`, compute signals first and pass them + the flags:

```ts
export async function answerBibleQuestion(
  prompt: string,
  options: { escalate?: boolean; autoEscalate?: boolean } = {}
): Promise<AssistantAnswer> {
  const signals = extractSignals(prompt);
  const routing = routeAssistantPrompt(prompt, {
    escalate: options.escalate ?? false,
    autoEscalate: options.autoEscalate ?? false,
    signals
  });
  // …rest unchanged (runRetrievalPlan uses signals; synthesis already passes signals.intent)…
}
```

In `app/api/assistant/route.ts`, extend the schema + call:

```ts
const assistantSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required.").max(ASSISTANT_MAX_PROMPT_CHARS, /* msg */),
  sessionId: z.string().trim().max(200).optional(),
  escalate: z.boolean().optional(),
  autoEscalate: z.boolean().optional()   // opt-in auto-scholarly from the user preference
});
// …
const { prompt, sessionId: requestedSessionId = "", escalate = false, autoEscalate = false } = valid.data;
// …
const answer = await answerBibleQuestion(prompt, { escalate, autoEscalate });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- modelRouter assistant assistant-route`
Expected: PASS. Add an assistant-route test asserting `autoEscalate: true` is accepted (200) and forwarded. If `tests/unit/lib/ai/assistant.test.ts` mocks `routeAssistantPrompt`/synthesis, assert escalated routing yields `modelRole: "scholarly"` and the scholarly model id is the one passed to `responses.create` (not the default).
Run: `npm run lint` and `npx tsc --noEmit --pretty false` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/modelRouter.ts lib/ai/assistant.ts app/api/assistant/route.ts tests/unit/lib/ai/modelRouter.test.ts tests/unit/lib/ai/assistant.test.ts tests/unit/api/assistant-route.test.ts
git commit -m "feat(assistant): opt-in first-pass scholarly auto-escalation" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Auto-scholarly preference (cookie + toggle)

**Files:**
- Modify: `lib/readerPrefs.ts` (cookie name + parse helper — it already holds the pref-cookie infra)
- Modify: `app/assistant/page.tsx` (read cookie, pass prop)
- Modify: `components/AiAssistant.tsx` (toggle writes cookie; submit sends `autoEscalate`)
- Test: `tests/unit/lib/readerPrefs.test.ts` (or new) for the parser; component coverage via the acceptance suite

**Interfaces:**
- Consumes: `writePrefCookie` from `@/lib/readerPrefs`.
- Produces: `ASSISTANT_AUTO_SCHOLARLY_COOKIE` constant + `parseAutoScholarly(value): boolean`; `AiAssistant` gains an `autoScholarly?: boolean` prop and sends `autoEscalate: true` on normal (non-manual-escalate) submits when the toggle is on.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/readerPrefs.test.ts (create if absent)
import { describe, expect, it } from "vitest";
import { ASSISTANT_AUTO_SCHOLARLY_COOKIE, parseAutoScholarly } from "@/lib/readerPrefs";

describe("parseAutoScholarly", () => {
  it("treats '1' as enabled and everything else as disabled", () => {
    expect(parseAutoScholarly("1")).toBe(true);
    expect(parseAutoScholarly("0")).toBe(false);
    expect(parseAutoScholarly(undefined)).toBe(false);
  });
  it("exposes a stable cookie name", () => {
    expect(ASSISTANT_AUTO_SCHOLARLY_COOKIE).toBe("textlab-assistant-auto-scholarly");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Write the implementation**

Add to `lib/readerPrefs.ts`:

```ts
export const ASSISTANT_AUTO_SCHOLARLY_COOKIE = "textlab-assistant-auto-scholarly";

export function parseAutoScholarly(value: string | null | undefined): boolean {
  return value === "1";
}
```

In `app/assistant/page.tsx`, read it and pass the prop:

```ts
import { introCookieName, ASSISTANT_AUTO_SCHOLARLY_COOKIE, parseAutoScholarly } from "@/lib/readerPrefs";
// …inside the component, after introDismissed:
const autoScholarly = parseAutoScholarly((await cookies()).get(ASSISTANT_AUTO_SCHOLARLY_COOKIE)?.value);
// …pass to the component:
<AiAssistant autoScholarly={autoScholarly} initialNotes={/* …unchanged… */} />
```

In `components/AiAssistant.tsx`:
1. Add `autoScholarly?: boolean` to the props type; initialize state `const [autoScholarly, setAutoScholarly] = useState(Boolean(props.autoScholarly));`.
2. In the request body of `runPrompt(promptText, escalate)`, send the flag on normal submits:

```ts
body: JSON.stringify({
  prompt: promptText,
  ...(response?.sessionId ? { sessionId: response.sessionId } : {}),
  ...(escalate ? { escalate: true } : {}),
  ...(autoScholarly && !escalate ? { autoEscalate: true } : {})
})
```

3. Render a checkbox near the prompt form that persists the preference:

```tsx
import { ASSISTANT_AUTO_SCHOLARLY_COOKIE, writePrefCookie } from "@/lib/readerPrefs";

<label className="flex items-center gap-2 text-sm text-slate-700">
  <input
    type="checkbox"
    checked={autoScholarly}
    onChange={(e) => {
      setAutoScholarly(e.target.checked);
      writePrefCookie(ASSISTANT_AUTO_SCHOLARLY_COOKIE, e.target.checked ? "1" : "0");
    }}
  />
  Automatically use the scholarly model when a question warrants it
  <span className="text-slate-500">(may be slower / more thorough)</span>
</label>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/readerPrefs.test.ts`
Expected: PASS.
Run: `npm run lint` and `npx tsc --noEmit --pretty false` → clean.
Manual: `npm run dev`, toggle on, ask "How do Paul and James reconcile faith and works?", and confirm the routing line reports auto-escalation to the scholarly model.

- [ ] **Step 5: Commit**

```bash
git add lib/readerPrefs.ts app/assistant/page.tsx components/AiAssistant.tsx tests/unit/lib/readerPrefs.test.ts
git commit -m "feat(assistant): opt-in auto-scholarly preference toggle (cookie-backed)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Measurement — 2A faithfulness snapshot (manual, no code)

**Files:**
- Create: `docs/superpowers/notes/2026-06-26-stage1-2A-faithfulness-snapshot.md` (results record)

This task is a measurement procedure, not a code change. It requires `.env.test` (Neon test branch) + `OPENAI_API_KEY` + `AI_GATEWAY_API_KEY`.

- [ ] **Step 1: Capture the baseline (before)**

Check out `main` (or the pre-Task-1 commit). Run the non-blocking hybrid report:

Run: `npm run eval:report`
Save `eval/output/*.json` + `*.html` as the **baseline**. Record mean faithfulness and, for each ✗ statement, its bucket (A interpretation / B lexical / C outside / "defensible derivation").

- [ ] **Step 2: Capture the after**

Check out the branch with Tasks 1–9 merged. Run the same report:

Run: `npm run eval:report`
Save the **after** artifacts.

- [ ] **Step 3: Diff and record**

In the notes file, record: mean faithfulness before/after; the change in ✗ composition (B/C overreach should fall; remaining ✗'s should be defensible interpretation); and for every `Going further` ✗, classify it **defensible derivation** vs **genuine leap**. This classification is the raw input that designs the 2B split-metric rubric (a later, separate change — out of scope here).

- [ ] **Step 4: Commit the snapshot**

```bash
git add docs/superpowers/notes/2026-06-26-stage1-2A-faithfulness-snapshot.md
git commit -m "docs(eval): Stage 1 2A faithfulness before/after snapshot" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before opening a PR)

- [ ] Run the full local gate: `npm run verify` → exits 0 (lint, tsc, build, unit + coverage at 80/80/75/65).
- [ ] Run `npm run test:integration -- passage-tokens` against the Neon test branch → PASS (or clean skip).
- [ ] Run `npm run test:acceptance` and update `scripts/acceptance-test.js` for any answer-shape assertion the new format changes (the `/assistant` interaction). Update in lockstep.
- [ ] Confirm the deterministic eval gate is unaffected: `npm run eval:gate` → PASS.
- [ ] When Stage 1 lands, the `PROJECT_STATE.md` Stage 1/Stage 2 pointer is already in place (committed during planning); flip its wording from "spec'd" to "landed" and confirm the Stage 2 memory entry still reflects reality.

---

## Self-Review (author's check against the spec)

**Spec coverage:** Component 1 → Tasks 1–4; Component 2 → Task 5; Component 3 (prose contract) → Task 5 (the `Going further` heading + derivation rule live in the prompt); Component 4 → Task 6; Component 5 → Tasks 7–9; Measurement 2A → Task 10; guardrails (retrieved-only, anti-overclaim, missing-data) → Task 5 prompt; total enrichment budget → Task 3 (`MAX_ENRICHED_PASSAGES`); content-word bypass → Tasks 1 + 3; test-impact sweep → Task 8 + Final verification.

**Deferred-to-plan items now pinned:** annotation format (Task 1), POS stoplist + bypass (Task 1/3), total-budget mechanism (Task 3 — deterministic first-N-passages), token ordering (Task 2 — verse then wordIndex), escalation precedence (Task 8).

**Type consistency:** `PassageToken` defined in Task 1, consumed unchanged in Tasks 2–3; `getPassageTokens`/`PassageTokenRow` defined in Task 2, consumed in Task 3; `recommendScholarlyUpgrade(prompt, signals?)` defined in Task 7, consumed in Task 8; `routeAssistantPrompt(prompt, options)` defined in Task 8 and used by `answerBibleQuestion`; `buildSynthesisInstructions(intent)` defined in Task 5 used by `synthesizeWithRefinement`. `gloss` added to `HydratedToken` (Task 4) is consumed by the planner evidence lines in the same task.

**Out of scope (unchanged):** structured `core[]`/`goingFurther[]` schema, token-level claim refs, DB-backed escalation preference, the 2B judge rubric — all Stage 2 / later.
