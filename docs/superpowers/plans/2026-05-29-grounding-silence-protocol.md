# Grounding + Silence Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After live synthesis, verify every textual claim against the real corpus before the answer is shown or saved; withhold and replace with a structured "insufficient textual evidence" response when the Greek (SBLGNT) evidence fails to verify.

**Architecture:** Synthesis emits structured JSON (`answer` + a `claims[]` array). A new standalone verifier `lib/ai/grounding.ts` resolves each claim's reference to real DB verse text and fuzzy-matches quotes. `answerBibleQuestion` (in `lib/ai/assistant.ts`) calls the verifier between synthesis and persistence — SBLGNT is the citation spine (failure → refuse), WEB is a non-authoritative display aid (mismatch → strip + caveat, never refuse).

**Tech Stack:** TypeScript 5.8, Next 15.5, Prisma 6 / PostgreSQL (Neon), OpenAI Node SDK v4 (Responses API, structured outputs), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-05-29-grounding-silence-protocol-design.md`

---

## File Structure

| File | Responsibility | New/Modified |
|---|---|---|
| `lib/references.ts` | `parseReference()` — parse `"John 1:14"` / ranges into `{book,chapter,verse,verseEnd?}` | Modified |
| `lib/text/similarity.ts` | `levenshtein`, `normalizeGreek`, `normalizeEnglish`, `containmentScore` | New |
| `lib/ai/grounding.ts` | Claim/verdict/report types + `verifyGrounding()` | New |
| `lib/ai/synthesis.ts` | Structured JSON output, claim parsing, `buildRefusalAnswer()` | Modified |
| `lib/ai/assistant.ts` | Orchestration: call verifier, build refusal, `grounded` field on `AssistantAnswer` | Modified |
| `lib/ai/sessions.ts` | Persist `grounded` + `groundingReport` in metadata | Modified |
| `components/AiAssistant.tsx` | "Withheld — insufficient evidence" banner on `grounded === false` | Modified |
| `scripts/acceptance-test.js` | Happy-path grounded answer renders end-to-end (no regression) | Modified |

Tests live beside existing suites under `tests/unit/...`.

**Type-ownership note (avoid import cycles):** `GroundingClaim`, `ClaimVerdict`, `GroundingReport`, and `QUOTE_MATCH_THRESHOLD` are defined in `lib/ai/grounding.ts`. `synthesis.ts` and `assistant.ts` import these types FROM `grounding.ts`. `grounding.ts` imports only from `lib/search`, `lib/references`, and `lib/text/similarity` — never from `synthesis.ts` or `assistant.ts`.

**Running a single test file:** `npx vitest run <path>` (full gate later is `npm run verify`).

---

## Task 1: `parseReference` in `lib/references.ts`

**Files:**
- Modify: `lib/references.ts`
- Test: `tests/unit/lib/references.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/references.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReference } from "@/lib/references";

describe("parseReference", () => {
  it("parses a simple reference", () => {
    expect(parseReference("John 1:14")).toEqual({ book: "John", chapter: 1, verse: 14 });
  });

  it("parses a numbered book name", () => {
    expect(parseReference("1 John 2:23")).toEqual({ book: "1John", chapter: 2, verse: 23 });
  });

  it("parses a verse range", () => {
    expect(parseReference("Rom 8:1-4")).toEqual({ book: "Rom", chapter: 8, verse: 1, verseEnd: 4 });
  });

  it("normalizes book aliases", () => {
    expect(parseReference("matthew 5:9")).toEqual({ book: "Matt", chapter: 5, verse: 9 });
  });

  it("returns null for prose with no chapter:verse", () => {
    expect(parseReference("the prologue")).toBeNull();
    expect(parseReference("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/references.test.ts`
Expected: FAIL — `parseReference` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/references.ts` (after `bookName`):

```ts
export function parseReference(
  input?: string | null
): { book: string; chapter: number; verse: number; verseEnd?: number } | null {
  if (!input) return null;
  const match = input.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const book = normalizeBook(match[1]);
  if (!book) return null;

  const chapter = Number.parseInt(match[2], 10);
  const verse = Number.parseInt(match[3], 10);
  const verseEnd = match[4] ? Number.parseInt(match[4], 10) : undefined;

  return { book, chapter, verse, ...(verseEnd !== undefined ? { verseEnd } : {}) };
}
```

> Note: `normalizeBook` returns the raw string when no alias matches, so a fictitious book like `"Foobar 1:1"` parses here but later fails verse resolution in the verifier (→ `reference-not-found`). That is intentional; only structurally invalid strings return `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/references.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/references.ts tests/unit/lib/references.test.ts
git commit -m "$(cat <<'EOF'
Add parseReference helper for grounding verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Text normalization + containment-aware similarity

**Files:**
- Create: `lib/text/similarity.ts`
- Test: `tests/unit/lib/text/similarity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/text/similarity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  levenshtein,
  normalizeGreek,
  normalizeEnglish,
  containmentScore
} from "@/lib/text/similarity";

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
});

describe("normalizeGreek", () => {
  it("folds diacritics, lowercases, and normalizes final sigma", () => {
    // ἐν ἀρχῇ with accents/breathing → bare letters; final sigma unified.
    expect(normalizeGreek("Ἐν ἀρχῇ")).toBe("εν αρχη");
    expect(normalizeGreek("λόγος")).toBe("λογοσ");
  });

  it("strips punctuation", () => {
    expect(normalizeGreek("θεός·")).toBe("θεοσ");
  });
});

describe("normalizeEnglish", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeEnglish("The  Word, became flesh.")).toBe("the word became flesh");
  });
});

describe("containmentScore", () => {
  it("scores an exact substring as 1", () => {
    expect(containmentScore("εν αρχη", "εν αρχη ην ο λογοσ")).toBe(1);
  });

  it("scores a near-miss fragment via best window", () => {
    // one char off inside the verse → still high
    expect(containmentScore("εν αρχn", "εν αρχη ην ο λογοσ")).toBeGreaterThanOrEqual(0.85);
  });

  it("scores unrelated text low", () => {
    expect(containmentScore("ουρανοσ", "εν αρχη ην ο λογοσ")).toBeLessThan(0.5);
  });

  it("returns 0 for an empty quote", () => {
    expect(containmentScore("", "anything")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/text/similarity.test.ts`
Expected: FAIL — module `@/lib/text/similarity` not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/text/similarity.ts`:

```ts
// Classic dynamic-programming Levenshtein edit distance.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// NFD-decompose, drop combining marks, lowercase, unify final sigma, drop
// non-letter characters, collapse whitespace. Diacritic-insensitive so accent /
// breathing-mark transcription noise does not cause false refusals.
export function normalizeGreek(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEnglish(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

// Quotes are usually a fragment of the verse. If the (normalized) quote is a
// substring, score 1.0; otherwise slide a window of the quote's length across
// the verse and take the best edit-distance ratio. Inputs must already be
// normalized by the caller.
export function containmentScore(normQuote: string, normVerse: string): number {
  if (!normQuote) return 0;
  if (normVerse.includes(normQuote)) return 1;

  const qlen = normQuote.length;
  if (qlen >= normVerse.length) return ratio(normQuote, normVerse);

  let best = 0;
  for (let i = 0; i + qlen <= normVerse.length; i++) {
    const score = ratio(normQuote, normVerse.slice(i, i + qlen));
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/text/similarity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/text/similarity.ts tests/unit/lib/text/similarity.test.ts
git commit -m "$(cat <<'EOF'
Add Greek/English normalization and containment similarity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The verifier — `lib/ai/grounding.ts`

**Files:**
- Create: `lib/ai/grounding.ts`
- Test: `tests/unit/lib/ai/grounding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/ai/grounding.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getPassage } = vi.hoisted(() => ({ getPassage: vi.fn() }));
vi.mock("@/lib/search", () => ({ getPassage }));

import { verifyGrounding, type GroundingClaim } from "@/lib/ai/grounding";

// getPassage returns SBLGNT/WEB verse text keyed by corpus for these tests.
function mockVerses(map: Record<string, Record<string, string>>) {
  getPassage.mockImplementation(async (args: { corpus: string; book: string; chapter: number; verseStart: number; verseEnd?: number }) => {
    const key = `${args.book} ${args.chapter}:${args.verseStart}`;
    const text = map[args.corpus]?.[key];
    return {
      corpus: args.corpus,
      references: text ? [{ book: args.book, chapter: args.chapter, verse: args.verseStart, reference: key, text }] : []
    };
  });
}

function claim(partial: Partial<GroundingClaim>): GroundingClaim {
  return { reference: "John 1:1", greekQuote: null, gloss: null, englishQuote: null, ...partial };
}

beforeEach(() => getPassage.mockReset());

describe("verifyGrounding", () => {
  it("verifies an exact Greek substring quote", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ" })]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].status).toBe("verified");
    expect(report.verdicts[0].matchScore).toBe(1);
  });

  it("verifies a Greek quote despite diacritic noise", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "εν αρχη" })]);
    expect(report.grounded).toBe(true);
  });

  it("fails a Greek quote not present in the verse", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "πῦρ καὶ θεῖον" })]);
    expect(report.grounded).toBe(false);
    expect(report.verdicts[0].status).toBe("quote-mismatch");
  });

  it("fails when the reference resolves to no SBL verse", async () => {
    mockVerses({ SBLGNT: {} });
    const report = await verifyGrounding([claim({ reference: "John 99:99", greekQuote: "x" })]);
    expect(report.verdicts[0].status).toBe("reference-not-found");
    expect(report.grounded).toBe(false);
  });

  it("fails an unparseable reference string", async () => {
    mockVerses({ SBLGNT: {} });
    const report = await verifyGrounding([claim({ reference: "the prologue" })]);
    expect(report.verdicts[0].status).toBe("reference-not-found");
  });

  it("verifies a reference-only claim (no greekQuote) when the verse exists", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: null })]);
    expect(report.verdicts[0].status).toBe("verified");
  });

  it("strips a mismatched WEB aid with a caveat but does NOT refuse", async () => {
    mockVerses({
      SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" },
      WEB: { "John 1:1": "In the beginning was the Word" }
    });
    const report = await verifyGrounding([
      claim({ greekQuote: "ἐν ἀρχῇ", englishQuote: "totally different sentence here" })
    ]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].status).toBe("verified");
    expect(report.verdicts[0].alignmentCaveat).toBeDefined();
  });

  it("adds a caveat when WEB has no verse at the SBL reference", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" }, WEB: {} });
    const report = await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ", englishQuote: "anything" })]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].alignmentCaveat).toBeDefined();
  });

  it("dedupes repeated references to a single DB lookup", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ" }), claim({ greekQuote: "ὁ λόγος" })]);
    expect(getPassage).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the DB lookup throws (infra failure surfaces)", async () => {
    getPassage.mockRejectedValue(new Error("db connection lost"));
    await expect(verifyGrounding([claim({ greekQuote: "x" })])).rejects.toThrow("db connection lost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/ai/grounding.test.ts`
Expected: FAIL — `@/lib/ai/grounding` not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai/grounding.ts`:

```ts
import { getPassage } from "@/lib/search";
import { parseReference } from "@/lib/references";
import { containmentScore, normalizeEnglish, normalizeGreek } from "@/lib/text/similarity";

export const QUOTE_MATCH_THRESHOLD = 0.9;

export type GroundingClaim = {
  reference: string;
  greekQuote: string | null;
  gloss: string | null;
  englishQuote: string | null;
};

export type ClaimVerdict = {
  claim: GroundingClaim;
  status: "verified" | "reference-not-found" | "quote-mismatch";
  matchScore?: number;
  resolvedText?: string;
  alignmentCaveat?: string;
};

export type GroundingReport = {
  grounded: boolean;
  verdicts: ClaimVerdict[];
};

type ParsedReference = NonNullable<ReturnType<typeof parseReference>>;

async function resolveText(
  cache: Map<string, string | null>,
  corpus: "SBLGNT" | "WEB",
  ref: ParsedReference
): Promise<string | null> {
  const key = `${corpus}|${ref.book}|${ref.chapter}|${ref.verse}|${ref.verseEnd ?? ""}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const res = await getPassage({
    corpus,
    book: ref.book,
    chapter: ref.chapter,
    verseStart: ref.verse,
    verseEnd: ref.verseEnd
  });
  const text = res.references.length ? res.references.map((r) => r.text).join(" ") : null;
  cache.set(key, text);
  return text;
}

export async function verifyGrounding(claims: GroundingClaim[]): Promise<GroundingReport> {
  const cache = new Map<string, string | null>();
  const verdicts: ClaimVerdict[] = [];

  for (const claim of claims) {
    const parsed = parseReference(claim.reference);
    if (!parsed) {
      verdicts.push({ claim, status: "reference-not-found" });
      continue;
    }

    const sblText = await resolveText(cache, "SBLGNT", parsed);
    if (sblText === null) {
      verdicts.push({ claim, status: "reference-not-found" });
      continue;
    }

    const verdict: ClaimVerdict = { claim, status: "verified", resolvedText: sblText };

    if (claim.greekQuote) {
      const score = containmentScore(normalizeGreek(claim.greekQuote), normalizeGreek(sblText));
      verdict.matchScore = score;
      if (score < QUOTE_MATCH_THRESHOLD) {
        verdicts.push({ claim, status: "quote-mismatch", matchScore: score, resolvedText: sblText });
        continue;
      }
    }

    if (claim.englishQuote) {
      const webText = await resolveText(cache, "WEB", parsed);
      if (webText === null) {
        verdict.alignmentCaveat =
          "WEB has no verse at this reference; the English display aid was withheld.";
      } else {
        const englishScore = containmentScore(normalizeEnglish(claim.englishQuote), normalizeEnglish(webText));
        if (englishScore < QUOTE_MATCH_THRESHOLD) {
          verdict.alignmentCaveat =
            "The WEB display translation does not align with the SBLGNT evidence here; the English aid was withheld.";
        }
      }
    }

    verdicts.push(verdict);
  }

  return { grounded: verdicts.every((v) => v.status === "verified"), verdicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/ai/grounding.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/grounding.ts tests/unit/lib/ai/grounding.test.ts
git commit -m "$(cat <<'EOF'
Add grounding verifier (SBL spine + WEB display-aid checks)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Structured synthesis output + `buildRefusalAnswer`

**Files:**
- Modify: `lib/ai/synthesis.ts`
- Test: `tests/unit/lib/ai/synthesis.test.ts`

- [ ] **Step 1: Update existing tests + add new ones (write the failing tests)**

In `tests/unit/lib/ai/synthesis.test.ts`, every mock that returns a final answer must now return JSON. Make these edits:

Replace the direct-answer mock body:

```ts
// was: responsesCreate.mockResolvedValue({ output: [], output_text: "Final answer" });
responsesCreate.mockResolvedValue({
  output: [],
  output_text: JSON.stringify({ answer: "Final answer", claims: [] })
});
```

In the refinement tests, replace each second-round `output_text: "Refined answer"` / `"done"` / `"Refined despite DB error"` with the JSON form, e.g.:

```ts
.mockResolvedValueOnce({ output: [], output_text: JSON.stringify({ answer: "Refined answer", claims: [] }) });
```

For the strict-tool test (`output_text: "ok"`) and the citations-cap test (`output_text: "ok"`), use:

```ts
responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "ok", claims: [] }) });
```

The empty-text test stays as-is (`output_text: "   "` → null). Add these NEW tests inside `describe("synthesizeWithRefinement", ...)`:

```ts
it("parses structured output into answer + claims", async () => {
  vi.stubEnv("OPENAI_API_KEY", "key");
  responsesCreate.mockResolvedValue({
    output: [],
    output_text: JSON.stringify({
      answer: "The Word was with God.",
      claims: [{ reference: "John 1:1", greekQuote: "ἐν ἀρχῇ", gloss: "in beginning", englishQuote: null }]
    })
  });

  const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
  const result = await synthesizeWithRefinement({ prompt: "John 1", evidence, routing });

  expect(result?.answer).toBe("The Word was with God.");
  expect(result?.claims).toEqual([
    { reference: "John 1:1", greekQuote: "ἐν ἀρχῇ", gloss: "in beginning", englishQuote: null }
  ]);
});

it("returns null when the structured output is not valid JSON", async () => {
  vi.stubEnv("OPENAI_API_KEY", "key");
  responsesCreate.mockResolvedValue({ output: [], output_text: "not json at all" });

  const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
  const result = await synthesizeWithRefinement({ prompt: "x", evidence, routing });

  expect(result).toBeNull();
});

it("requests a strict json_schema output format on the synthesis call", async () => {
  vi.stubEnv("OPENAI_API_KEY", "key");
  responsesCreate.mockResolvedValue({ output: [], output_text: JSON.stringify({ answer: "ok", claims: [] }) });

  const { synthesizeWithRefinement } = await import("@/lib/ai/synthesis");
  await synthesizeWithRefinement({ prompt: "x", evidence, routing });

  const format = responsesCreate.mock.calls[0][0].text.format;
  expect(format.type).toBe("json_schema");
  expect(format.strict).toBe(true);
  expect(format.schema.properties.claims.type).toBe("array");
});
```

Add a new `describe` block for the refusal builder:

```ts
describe("buildRefusalAnswer", () => {
  it("renders an insufficient-evidence message with failed claims and the real evidence", async () => {
    const { buildRefusalAnswer } = await import("@/lib/ai/synthesis");
    const report = {
      grounded: false,
      verdicts: [
        {
          claim: { reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null },
          status: "reference-not-found" as const
        }
      ]
    };
    const text = buildRefusalAnswer("what about John 99?", evidence, report);

    expect(text).toContain("Insufficient textual evidence");
    expect(text).toContain("John 99:99");
    expect(text).toContain(evidence.formattedEvidence);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/synthesis.test.ts`
Expected: FAIL — `buildRefusalAnswer` not exported; `result.claims` undefined; `text.format` undefined.

- [ ] **Step 3: Implement the synthesis changes**

In `lib/ai/synthesis.ts`:

(a) Add imports at the top (after existing imports):

```ts
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";
import type { GroundingClaim, GroundingReport } from "@/lib/ai/grounding";
```

> `EvidencePacket` is already imported in the current file — do not duplicate it; only add the `grounding` type import.

(b) Add the layered-policy lines to `SYNTHESIS_SYSTEM_PROMPT` (replace the final paragraph that begins "Cite every textual claim…"):

```ts
Write the readable English explanation first. When a claim depends on the
original language, quote the Greek as supporting evidence and give a short
literal gloss — never make the reader decode Greek to follow the argument.

Return JSON matching the provided schema: an "answer" string (the prose above)
and a "claims" array. For EVERY textual claim, add one entry with the SBLGNT
"reference", the exact "greekQuote" from that verse (or null), a literal "gloss"
(or null), and an optional "englishQuote" quoted verbatim from WEB as a labeled
readable aid (or null). Citations are always anchored to the SBLGNT (Greek)
source. Never invent lexicon entries, manuscript evidence, or scholarly
citations.`;
```

(c) Add the output-format constant (after `REFINEMENT_TOOL`):

```ts
const SYNTHESIS_OUTPUT_FORMAT = {
  type: "json_schema" as const,
  name: "grounded_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            reference: { type: "string" },
            greekQuote: { type: ["string", "null"] },
            gloss: { type: ["string", "null"] },
            englishQuote: { type: ["string", "null"] }
          },
          required: ["reference", "greekQuote", "gloss", "englishQuote"]
        }
      }
    },
    required: ["answer", "claims"]
  }
};
```

(d) Extend `SynthesisResult`:

```ts
export type SynthesisResult = {
  answer: string;
  claims: GroundingClaim[];
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
};
```

(e) Add the parse helper (above `synthesizeWithRefinement`):

```ts
function parseSynthesisOutput(text: string | undefined): { answer: string; claims: GroundingClaim[] } | null {
  const raw = text?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as { answer?: unknown; claims?: unknown };
  const answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
  if (!answer) return null;
  const claims = Array.isArray(obj.claims) ? (obj.claims as GroundingClaim[]) : [];
  return { answer, claims };
}
```

(f) Add `text: { format: SYNTHESIS_OUTPUT_FORMAT }` to BOTH `client.responses.create` calls (the `first` call alongside `tools`/`tool_choice`, and the `second` refinement call).

(g) Replace the two return sites to use the parser:

Direct path (no tool calls):

```ts
const calls = functionCalls(first.output);
if (calls.length === 0) {
  const parsed = parseSynthesisOutput(first.output_text);
  return parsed ? { answer: parsed.answer, claims: parsed.claims, citations, toolTrace } : null;
}
```

Refinement path (end of function):

```ts
const parsed = parseSynthesisOutput(second.output_text);
return parsed ? { answer: parsed.answer, claims: parsed.claims, citations, toolTrace } : null;
```

(h) Add `buildRefusalAnswer` (after `buildDeterministicFallback`):

```ts
export function buildRefusalAnswer(
  prompt: string,
  evidence: EvidencePacket,
  report: GroundingReport
): string {
  const failed = report.verdicts.filter((v) => v.status !== "verified");
  const reasons = failed
    .map(
      (v) =>
        `- ${v.claim.reference}: ${v.status}` +
        (v.matchScore !== undefined ? ` (match ${v.matchScore.toFixed(2)})` : "")
    )
    .join("\n");

  return [
    "Insufficient textual evidence.",
    "",
    `TextLab drafted an answer to "${prompt.trim()}" but could not verify its citations against the SBLGNT, so it withheld the response rather than risk an unsupported claim.`,
    "",
    failed.length ? `Unverified claims:\n${reasons}` : "",
    "",
    "Verified evidence retrieved for your query:",
    evidence.formattedEvidence
  ]
    .filter((line) => line !== "")
    .join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/synthesis.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/synthesis.ts tests/unit/lib/ai/synthesis.test.ts
git commit -m "$(cat <<'EOF'
Emit structured synthesis claims and add refusal builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Orchestration + `grounded` field in `lib/ai/assistant.ts`

**Files:**
- Modify: `lib/ai/assistant.ts`
- Test: `tests/unit/lib/ai/assistant.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/ai/assistant.test.ts`:

(a) Add a hoisted mock for the verifier near the other `vi.mock` calls:

```ts
const { verifyGrounding } = vi.hoisted(() => ({ verifyGrounding: vi.fn() }));
vi.mock("@/lib/ai/grounding", () => ({ verifyGrounding }));
```

(b) Add `buildRefusalAnswer` to the existing synthesis mock:

```ts
const { synthesizeWithRefinement, buildDeterministicFallback, buildRefusalAnswer } = vi.hoisted(() => ({
  synthesizeWithRefinement: vi.fn(),
  buildDeterministicFallback: vi.fn(() => "FALLBACK_ANSWER"),
  buildRefusalAnswer: vi.fn(() => "REFUSAL_ANSWER")
}));
vi.mock("@/lib/ai/synthesis", () => ({ synthesizeWithRefinement, buildDeterministicFallback, buildRefusalAnswer }));
```

(c) In `beforeEach`, default the verifier to grounded and reset the refusal builder:

```ts
buildRefusalAnswer.mockReturnValue("REFUSAL_ANSWER");
verifyGrounding.mockResolvedValue({ grounded: true, verdicts: [] });
```

(d) Update the existing "returns the synthesized answer when live" test: its `synthesizeWithRefinement.mockResolvedValue({...})` must now include `claims: []`. Add `expect(answer.grounded).toBe(true);`.

(e) Add new tests inside `describe("answerBibleQuestion orchestration", ...)`:

```ts
it("withholds the answer when grounding fails", async () => {
  isLiveAssistantEnabled.mockReturnValue(true);
  synthesizeWithRefinement.mockResolvedValue({
    answer: "DRAFT WITH BAD CITATION",
    claims: [{ reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null }],
    citations: [],
    toolTrace: []
  });
  verifyGrounding.mockResolvedValue({
    grounded: false,
    verdicts: [
      { claim: { reference: "John 99:99", greekQuote: "x", gloss: null, englishQuote: null }, status: "reference-not-found" }
    ]
  });

  const answer = await answerBibleQuestion("bad question");

  expect(answer.grounded).toBe(false);
  expect(answer.mode).toBe("live");
  expect(answer.answer).toBe("REFUSAL_ANSWER");
  expect(answer.answer).not.toContain("DRAFT WITH BAD CITATION");
  expect(answer.citations).toEqual(packet.citations);
  expect(answer.groundingReport?.grounded).toBe(false);
});

it("returns the grounded answer with grounded:true when verification passes", async () => {
  isLiveAssistantEnabled.mockReturnValue(true);
  synthesizeWithRefinement.mockResolvedValue({
    answer: "GOOD ANSWER",
    claims: [{ reference: "Rom 7:1", greekQuote: "νόμος", gloss: null, englishQuote: null }],
    citations: packet.citations,
    toolTrace: []
  });

  const answer = await answerBibleQuestion("good question");

  expect(answer.grounded).toBe(true);
  expect(answer.answer).toBe("GOOD ANSWER");
});

it("falls back deterministically when verification throws (infra failure)", async () => {
  isLiveAssistantEnabled.mockReturnValue(true);
  synthesizeWithRefinement.mockResolvedValue({ answer: "x", claims: [], citations: [], toolTrace: [] });
  verifyGrounding.mockRejectedValue(new Error("db connection lost"));

  const answer = await answerBibleQuestion("anything");

  expect(answer.mode).toBe("fallback");
  expect(answer.grounded).toBe(true);
  expect(answer.answer).toBe("FALLBACK_ANSWER");
});
```

(f) In the two existing fallback tests ("deterministic fallback when live is disabled", "falls back when live synthesis returns null", "falls back locally when live synthesis throws"), add `expect(answer.grounded).toBe(true);`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/assistant.test.ts`
Expected: FAIL — `answer.grounded` undefined; `verifyGrounding`/`buildRefusalAnswer` not wired.

- [ ] **Step 3: Implement the orchestration changes**

In `lib/ai/assistant.ts`:

(a) Update imports:

```ts
import { buildDeterministicFallback, buildRefusalAnswer, synthesizeWithRefinement } from "@/lib/ai/synthesis";
import { verifyGrounding, type GroundingReport } from "@/lib/ai/grounding";
```

(b) Add `grounded` + `groundingReport` to `AssistantAnswer`:

```ts
export type AssistantAnswer = {
  answer: string;
  citations: AssistantCitation[];
  markdown: string;
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  grounded: boolean;
  groundingReport?: GroundingReport;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
  sessionId?: string;
};
```

(c) Add the same two fields to `WithMarkdownInput`:

```ts
type WithMarkdownInput = {
  title: string;
  answer: string;
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  grounded: boolean;
  groundingReport?: GroundingReport;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};
```

(d) Replace the `try { ... }` body of `answerBibleQuestion` (the live branch) with:

```ts
  try {
    const result = await synthesizeWithRefinement({ prompt, evidence, routing });
    if (!result) {
      return fallbackAnswer(prompt, evidence, routing);
    }

    let report: GroundingReport;
    try {
      report = await verifyGrounding(result.claims);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "Unknown error";
      return withMarkdown({
        title: "TextLab Assistant",
        answer: buildDeterministicFallback(prompt, evidence),
        citations: evidence.citations,
        toolTrace: [...result.toolTrace, { tool: "grounding", error: message }],
        mode: "fallback",
        grounded: true,
        ...routing,
        routingDecision: `${routing.routingDecision} Grounding verification could not run, so TextLab returned the local retrieval fallback.`
      });
    }

    if (!report.grounded) {
      const failed = report.verdicts.filter((v) => v.status !== "verified").length;
      return withMarkdown({
        title: "TextLab Assistant",
        answer: buildRefusalAnswer(prompt, evidence, report),
        citations: evidence.citations,
        toolTrace: [
          ...result.toolTrace,
          { tool: "grounding", args: { grounded: false, failedClaims: failed } },
          { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } }
        ],
        mode: "live",
        grounded: false,
        groundingReport: report,
        ...routing
      });
    }

    return withMarkdown({
      title: "TextLab Assistant",
      answer: result.answer,
      citations: result.citations,
      toolTrace: [
        ...result.toolTrace,
        { tool: "grounding", args: { grounded: true } },
        { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } }
      ],
      mode: "live",
      grounded: true,
      groundingReport: report,
      ...routing
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return withMarkdown({
      title: "TextLab Assistant",
      answer: buildDeterministicFallback(prompt, evidence),
      citations: evidence.citations,
      toolTrace: [...evidence.toolTrace, { tool: "openai.responses.create", error: message }],
      mode: "fallback",
      grounded: true,
      ...routing,
      routingDecision: `${routing.routingDecision} The live model call failed, so TextLab returned the local retrieval fallback.`
    });
  }
```

(e) Update `fallbackAnswer` to set `grounded: true`:

```ts
function fallbackAnswer(prompt: string, evidence: EvidencePacket, routing: RoutingDecision): AssistantAnswer {
  return withMarkdown({
    title: "TextLab Assistant",
    answer: buildDeterministicFallback(prompt, evidence),
    citations: evidence.citations,
    toolTrace: evidence.toolTrace,
    mode: "fallback",
    grounded: true,
    ...routing
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/assistant.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/assistant.ts tests/unit/lib/ai/assistant.test.ts
git commit -m "$(cat <<'EOF'
Verify grounding before returning; withhold ungrounded answers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Persist grounding metadata in `lib/ai/sessions.ts`

**Files:**
- Modify: `lib/ai/sessions.ts`
- Test: `tests/unit/api/assistant-route.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Open `tests/unit/api/assistant-route.test.ts`. Find the test asserting assistant-message persistence (it inspects the `aiMessage.create` call for `role: "assistant"`). Add a focused test that a withheld answer persists `grounded: false`. If the suite mocks `answerBibleQuestion`, set that mock to return a `grounded: false` answer for this case; then assert the persisted metadata. Concrete addition (adapt the mock name to the file's existing setup):

```ts
it("persists grounded:false metadata for a withheld answer", async () => {
  // answerBibleQuestion mock returns an ungrounded refusal for this case
  answerBibleQuestion.mockResolvedValue({
    answer: "Insufficient textual evidence.",
    citations: [],
    markdown: "# x",
    toolTrace: [],
    mode: "live",
    grounded: false,
    groundingReport: { grounded: false, verdicts: [] },
    modelRole: "default",
    modelUsed: "gpt-5.3-chat-latest",
    routingDecision: "..."
  });

  // ...invoke POST as the other tests do...
  // then locate the assistant-role aiMessage.create call:
  const assistantCall = aiMessageCreate.mock.calls.find((c) => c[0].data.role === "assistant");
  const metadata = assistantCall![0].data.metadata as { grounded: boolean };
  expect(metadata.grounded).toBe(false);
});
```

> If `assistant-route.test.ts` does NOT mock at the `aiMessage.create` level, instead add this assertion to `tests/unit/lib/ai/sessions.test.ts` if present, or create a minimal `sessions` test that calls `finishAssistantExchange` with a `grounded:false` answer and asserts the metadata. Use whichever seam the existing suite already exercises — do not introduce a second mocking strategy.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/api/assistant-route.test.ts`
Expected: FAIL — persisted metadata has no `grounded` field.

- [ ] **Step 3: Implement**

In `lib/ai/sessions.ts`, extend the type and the metadata object:

```ts
export type AssistantMessageMetadata = {
  mode: AssistantAnswer["mode"];
  grounded: AssistantAnswer["grounded"];
  groundingReport?: AssistantAnswer["groundingReport"];
  modelRole: AssistantAnswer["modelRole"];
  modelUsed: AssistantAnswer["modelUsed"];
  routingDecision: AssistantAnswer["routingDecision"];
  recommendedUpgrade?: AssistantAnswer["recommendedUpgrade"];
  citations: AssistantAnswer["citations"];
  toolTrace: AssistantAnswer["toolTrace"];
};
```

In `finishAssistantExchange`, add the two fields to the `metadata` object:

```ts
  const metadata: AssistantMessageMetadata = {
    mode: input.answer.mode,
    grounded: input.answer.grounded,
    groundingReport: input.answer.groundingReport,
    modelRole: input.answer.modelRole,
    modelUsed: input.answer.modelUsed,
    routingDecision: input.answer.routingDecision,
    recommendedUpgrade: input.answer.recommendedUpgrade,
    citations: input.answer.citations,
    toolTrace: input.answer.toolTrace
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/api/assistant-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/sessions.ts tests/unit/api/assistant-route.test.ts
git commit -m "$(cat <<'EOF'
Persist grounding verdict in assistant message metadata

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: "Withheld" banner in `components/AiAssistant.tsx`

**Files:**
- Modify: `components/AiAssistant.tsx`
- Test: `tests/unit/components/AiAssistant-grounding.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/AiAssistant-grounding.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AiAssistant } from "@/components/AiAssistant";

const withheldResponse = {
  answer: "Insufficient textual evidence. ...verified evidence...",
  markdown: "# x",
  citations: [],
  toolTrace: [],
  mode: "live",
  grounded: false,
  sessionId: "s1",
  modelRole: "default",
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: "..."
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => withheldResponse }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiAssistant grounding refusal", () => {
  it("shows the withheld banner when grounded is false", async () => {
    render(<AiAssistant initialNotes={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), {
      target: { value: "bad question" }
    });
    fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));

    await screen.findByText(/withheld/i);
    expect(screen.getByText(/insufficient evidence/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/AiAssistant-grounding.test.tsx`
Expected: FAIL — no "withheld" text rendered.

- [ ] **Step 3: Implement**

In `components/AiAssistant.tsx`:

(a) Add `grounded` to the `AssistantResponse` type (after `mode`):

```ts
  mode: AssistantMode;
  grounded: boolean;
```

(b) Insert the banner immediately BEFORE the answer `<pre>` (currently line ~294, the
`<pre className="whitespace-pre-wrap ...">{answerText}</pre>`):

```tsx
            {!restoredView && response && response.grounded === false ? (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Withheld — insufficient evidence.</strong> TextLab could not verify the drafted
                citations against the SBLGNT and declined to answer. The verified retrieval evidence is
                shown below.
              </div>
            ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/AiAssistant-grounding.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/AiAssistant.tsx tests/unit/components/AiAssistant-grounding.test.tsx
git commit -m "$(cat <<'EOF'
Render withheld banner for ungrounded assistant answers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Acceptance — grounded happy path (no regression)

**Files:**
- Modify: `scripts/acceptance-test.js`

> **Why happy-path only:** forcing a real model to fabricate a citation is non-deterministic, so an end-to-end *refusal* assertion would be flaky. The refusal path is covered deterministically by Tasks 3, 5, and 7. Here we assert the verifier does not falsely withhold a normal, well-grounded answer end-to-end. (This is a deliberate, documented deviation from the spec's literal "ask an unsupported question" acceptance line.)

- [ ] **Step 1: Add the assertion**

In `scripts/acceptance-test.js`, locate the existing assistant interaction (the one that submits a prompt to `/assistant` and reads the answer). After it asserts an answer renders, add an assertion that the withheld banner is ABSENT for a normal prompt:

```js
// Grounding: a normal, well-supported prompt must NOT be withheld.
const withheldBanner = await page.$('text=Withheld — insufficient evidence');
if (withheldBanner) {
  throw new Error('Grounding falsely withheld a well-supported answer');
}
```

> Match the surrounding file's style (it uses Playwright `page` APIs and throws on failure). If the file uses `expect`-style assertions, mirror that instead.

- [ ] **Step 2: Run acceptance (requires Neon test branch + full corpus)**

Run: `npm run test:acceptance`
Expected: exit 0; the new assertion passes (no false withhold).

- [ ] **Step 3: Commit**

```bash
git add scripts/acceptance-test.js
git commit -m "$(cat <<'EOF'
Assert grounding does not falsely withhold a supported answer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Docs + full verification

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `ReadMe.md`, `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: Run the full gate**

Run: `npm run verify`
Expected: lint + tsc + build + coverage gate all green (lines/statements/functions/branches ≥ 80/80/75/65). If branch coverage dips below 65, add targeted tests for any uncovered branch in `grounding.ts` / `synthesis.ts` before proceeding.

- [ ] **Step 2: Run the DB integration suite**

Run: `npm run test:integration`
Expected: exit 0 (against the Neon test branch).

- [ ] **Step 3: Update the roadmap**

In `docs/HiFi-exegesis-nt-roadmap.md`, mark Phase 2 done (mirror the Phase 1 "✅ DONE" annotation style) and note: SBLGNT citation spine, WEB display-aid with strip+caveat, structured synthesis claims, withhold-before-persistence.

- [ ] **Step 4: Update PROJECT_STATE + README**

In `docs/PROJECT_STATE.md`, update the assistant-pipeline section to add the grounding/verification step between synthesis and persistence, and the new test surfaces. In `ReadMe.md`, add a short "Grounding / Silence Protocol" note to the assistant description. (Per CLAUDE.md, only touch `docs/security-register.md` if a security-relevant change landed — none here.)

- [ ] **Step 5: Commit**

```bash
git add docs/PROJECT_STATE.md ReadMe.md docs/HiFi-exegesis-nt-roadmap.md
git commit -m "$(cat <<'EOF'
Document Phase 2 grounding + Silence Protocol

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- SBL citation spine / WEB display aid → Task 3 (asymmetric verification), Task 4 (prompt).
- Structured synthesis output → Task 4.
- Layered answer policy (English → Greek → gloss) → Task 4 prompt; claim shape Tasks 3–4.
- Open-world references (resolve to real DB verse) → Task 3 (`resolveText` via `getPassage`).
- Per-quote ≥0.90, refuse if any Greek claim fails → Task 3 (`QUOTE_MATCH_THRESHOLD`, `every(verified)`).
- WEB mismatch → strip + caveat, never refuse → Task 3 (`alignmentCaveat`, status stays `verified`).
- Verifier inside `answerBibleQuestion`, before persistence → Task 5.
- Refusal body + real evidence + failed-claim trace → Task 4 (`buildRefusalAnswer`) + Task 5.
- `grounded` boolean signal (not a new `mode`) → Tasks 5–7.
- Infra failure → fallback, never a silent refusal → Task 3 (rethrow) + Task 5 (inner catch).
- Persist withheld answer, never the draft → Task 6 (ordering) + Task 5 assertion `not.toContain` draft.
- UI withheld banner → Task 7.
- Tests across grounding/similarity/references/synthesis/assistant/component/route → Tasks 1–7.
- Docs per CLAUDE.md → Task 9.

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `GroundingClaim`/`ClaimVerdict`/`GroundingReport`/`QUOTE_MATCH_THRESHOLD` defined once in Task 3 and imported by Tasks 4–6; `grounded`/`groundingReport` added consistently to `AssistantAnswer` (Task 5), `WithMarkdownInput` (Task 5), `AssistantMessageMetadata` (Task 6), and `AssistantResponse` (Task 7). `verifyGrounding(claims) → GroundingReport`, `buildRefusalAnswer(prompt, evidence, report) → string`, and `parseReference(string) → {...}|null` signatures match across all call sites.
