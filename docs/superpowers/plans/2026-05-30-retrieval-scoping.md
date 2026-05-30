# Retrieval Scoping & Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whole-chapter and word-study answers complete by scoping searches to the named location, returning bounded scopes in full, sampling large scopes at 25 + true count, and supporting cross-chapter passages.

**Architecture:** All logic lives in the deterministic planner. `lib/ai/signals.ts` learns to parse cross-chapter references (`2 Cor 4:16-5:10`); `lib/ai/retrievalPlanner.ts` threads a chapter scope into word searches, replaces the flat 10-line cap with a size rule for word searches and a full-chapter (+ ceiling) rule for passages, and assembles cross-chapter passages from per-chapter `getPassage` calls. No `lib/search.ts` signature change, no schema change.

**Tech Stack:** TypeScript 5.8, Vitest 4. The search layer (`searchLemma`/`searchKeyword`/`searchMorphology`) already accepts `chapter`; `getPassage` stays single-chapter.

**Spec:** `docs/superpowers/specs/2026-05-30-retrieval-scoping-design.md`

---

## File Structure

| File | Change |
|---|---|
| `lib/ai/signals.ts` | `ParsedReference.chapterEnd?`; extend `REFERENCE_REGEX` + `detectReferences` for cross-chapter ranges. |
| `lib/ai/retrievalPlanner.ts` | `scopeFor` (chapter derivation); scope + size rule in `lemmaCall`/`keywordCall`/`morphCall`; full-passage + cross-chapter assembly + ceiling in `passageCall`; new constants. |
| `tests/unit/lib/ai/signals.test.ts` | Cross-chapter parsing cases. |
| `tests/unit/lib/ai/retrievalPlanner.test.ts` | Scoping, size rule, full/cross-chapter passage cases; update one stale comment. |

**Run a single test file:** `npx vitest run <path>`. **Full gate:** `npm run verify`.

**Constants in `retrievalPlanner.ts`:**
- `MAX_SECTION_LINES = 10` — **kept** (not renamed); now used only as the per-call **citation** sample (citations stay bounded).
- `MAX_WORD_SAMPLE = 25` — NEW: word-search evidence lines + search `pageSize`.
- `MAX_PASSAGE_LINES = 120` — NEW: hard ceiling on passage evidence lines per corpus.
- `MAX_TOTAL_CITATIONS = 40` — unchanged.

---

## Task 1: Parse cross-chapter references (`signals.ts`)

**Files:**
- Modify: `lib/ai/signals.ts`
- Test: `tests/unit/lib/ai/signals.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these inside the existing `describe("detectReferences", …)` block in `tests/unit/lib/ai/signals.test.ts`:

```ts
  it("parses a cross-chapter range", () => {
    expect(detectReferences("2 Cor 4:16-5:10")).toEqual([
      { book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }
    ]);
  });

  it("parses a cross-chapter range with an en dash", () => {
    expect(detectReferences("Rom 7:25–8:4")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 25, chapterEnd: 8, verseEnd: 4 }
    ]);
  });

  it("keeps a same-chapter range free of chapterEnd", () => {
    expect(detectReferences("Rom 8:1-4")).toEqual([
      { book: "Rom", chapter: 8, verseStart: 1, verseEnd: 4 }
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/signals.test.ts`
Expected: FAIL — the cross-chapter cases produce `{chapter:4, verseStart:16, verseEnd:5}` (no `chapterEnd`), not the expected object.

- [ ] **Step 3: Add `chapterEnd` to the type**

In `lib/ai/signals.ts`, update `ParsedReference`:

```ts
export type ParsedReference = {
  book: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  chapterEnd?: number;
};
```

- [ ] **Step 4: Extend the regex and `detectReferences`**

Replace the existing `REFERENCE_REGEX` definition:

```ts
const REFERENCE_REGEX = (() => {
  const aliases = [...ALIAS_TO_OSIS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // Groups: 1=alias 2=chapter 3=verseStart 4=endChapter(optional) 5=endVerse
  // (?<![a-z0-9]) avoids matching aliases embedded in larger words (e.g. "rom" in "from").
  return new RegExp(
    `(?<![a-z0-9])(${aliases.join("|")})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\\u2013\\u2014]\\s*(?:(\\d+):)?(\\d+))?)?`,
    "gi"
  );
})();
```

Replace `detectReferences`:

```ts
export function detectReferences(prompt: string): ParsedReference[] {
  const out: ParsedReference[] = [];
  for (const match of prompt.matchAll(REFERENCE_REGEX)) {
    const alias = match[1].toLowerCase().replace(/\s+/g, " ");
    const book = ALIAS_TO_OSIS.get(alias);
    if (!book) continue;
    const reference: ParsedReference = { book, chapter: Number.parseInt(match[2], 10) };
    if (match[3] !== undefined) reference.verseStart = Number.parseInt(match[3], 10);
    if (match[5] !== undefined) reference.verseEnd = Number.parseInt(match[5], 10);
    if (match[4] !== undefined) reference.chapterEnd = Number.parseInt(match[4], 10);
    out.push(reference);
  }
  return out;
}
```

> Why this keeps same-chapter ranges intact: for `Rom 8:1-4` the `(?:(\d+):)?` end-chapter group needs a trailing `:` to match (`4:`), which isn't present, so group 4 stays undefined and group 5 captures `4` as `verseEnd`. Only `5:10`-style input fills group 4.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/signals.test.ts`
Expected: PASS — including the pre-existing `Rom 7:1-6`, `John 3:16`, multi-reference, and `romance languages` cases (unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/signals.ts tests/unit/lib/ai/signals.test.ts
git commit -m "$(cat <<'EOF'
Parse cross-chapter references (Book ch:v-ch:v)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Chapter-scope word searches + size-driven completeness (`retrievalPlanner.ts`)

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts`
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/ai/retrievalPlanner.test.ts` inside `describe("runRetrievalPlan", …)`:

```ts
  it("scopes a word search to a single named chapter", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "John", chapter: 1 }],
      greekWords: ["λόγος"],
      intent: "word-study",
      book: "John"
    });

    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: "λόγος", book: "John", chapter: 1 }));
  });

  it("does not chapter-scope a word search when only a book is named", async () => {
    await runRetrievalPlan({ ...emptySignals, greekWords: ["λόγος"], intent: "word-study", book: "John" });

    expect(searchLemma.mock.calls[0][0].chapter).toBeUndefined();
  });

  it("does not chapter-scope across a cross-chapter reference", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }],
      greekWords: ["λόγος"],
      intent: "word-study",
      book: "2Cor"
    });

    expect(searchLemma.mock.calls[0][0].chapter).toBeUndefined();
    expect(searchLemma.mock.calls[0][0].book).toBe("2Cor");
  });

  it("returns all word hits when the count is at or below the sample size", async () => {
    searchLemma.mockResolvedValueOnce({
      lemma: "λόγος",
      count: 2,
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ" },
        { tokenId: "t2", corpus: "SBLGNT", reference: "John 1:14", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "ὁ λόγος σὰρξ" }
      ],
      pagination: {}
    });

    const packet = await runRetrievalPlan({
      ...emptySignals, references: [{ book: "John", chapter: 1 }], greekWords: ["λόγος"], intent: "word-study", book: "John"
    });

    expect(packet.formattedEvidence).toContain("John 1:1");
    expect(packet.formattedEvidence).toContain("John 1:14");
    expect(packet.formattedEvidence).not.toContain("more)");
  });

  it("samples a large word search to 25 lines and shows the true total", async () => {
    const results = Array.from({ length: 25 }, (_, i) => ({
      tokenId: `t${i}`, corpus: "SBLGNT", reference: `John ${i + 1}:1`, surface: "ἀγάπη", lemma: "ἀγάπη", morphCode: "N-NSF", verseText: "x"
    }));
    searchLemma.mockResolvedValueOnce({ lemma: "ἀγάπη", count: 116, results, pagination: {} });

    const packet = await runRetrievalPlan({ ...emptySignals, greekWords: ["ἀγάπη"], intent: "word-study" });

    expect(packet.formattedEvidence).toContain("116 hit(s)");
    expect(packet.formattedEvidence).toContain("…(91 more)");
    // 25 table rows present (one per result)
    expect((packet.formattedEvidence.match(/\| John /g) ?? []).length).toBe(25);
  });

  it("requests a page size of at least 25 for word searches", async () => {
    await runRetrievalPlan({ ...emptySignals, greekWords: ["λόγος"], intent: "word-study" });
    expect(searchLemma.mock.calls[0][0].pageSize).toBeGreaterThanOrEqual(25);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: FAIL — `chapter` not passed, `pageSize` is 20, large search still slices to 10 / uses page length for the "more" count.

- [ ] **Step 3: Add constants**

In `lib/ai/retrievalPlanner.ts`, **keep** the existing `MAX_PLANNED_CALLS`, `MAX_SECTION_LINES`, and `MAX_TOTAL_CITATIONS` (do NOT rename `MAX_SECTION_LINES` — `passageCall` still uses it until Task 3). Update the `MAX_SECTION_LINES` comment and add the two new constants right after it, so the block reads:

```ts
// Bounds the number of DB-backed tool calls a single prompt can trigger.
const MAX_PLANNED_CALLS = 8;
// Per-call CITATION sample. Citations stay bounded (save-note caps at 50, the
// synthesis payload slices to 20) even when the evidence text is complete.
const MAX_SECTION_LINES = 10;
// Word-search evidence lines + page size: show all hits when count <= this, else
// this many + the true total count.
const MAX_WORD_SAMPLE = 25;
// Hard ceiling on passage evidence lines per corpus (no real NT chapter/pericope
// approaches this; it only stops a pathological whole-book range).
const MAX_PASSAGE_LINES = 120;
// Each call cites a bounded sample; the whole packet is capped so downstream
// consumers never overflow.
const MAX_TOTAL_CITATIONS = 40;
```

- [ ] **Step 4: Add the scope helper**

Add near the top of `retrievalPlanner.ts` (after the constants):

```ts
type Scope = { book?: string; chapter?: number };

// A single, single-chapter reference scopes word searches to that chapter. A
// cross-chapter reference, multiple references, or none falls back to book scope
// (or corpus-wide if no book is detected).
function scopeFor(signals: Signals): Scope {
  if (signals.references.length === 1) {
    const ref = signals.references[0];
    const singleChapter = ref.chapterEnd === undefined || ref.chapterEnd === ref.chapter;
    if (singleChapter) return { book: ref.book, chapter: ref.chapter };
  }
  return signals.book ? { book: signals.book } : {};
}
```

- [ ] **Step 5: Rework the three word-search builders**

Replace `lemmaCall`, `keywordCall`, and `morphCall` with these scope-aware, size-rule versions:

```ts
function lemmaCall(lemma: string, scope: Scope): PlannedCall {
  const args: { lemma: string; book?: string; chapter?: number } = { lemma };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const label = `${lemma}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  return {
    key: `lemma:${lemma}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchLemma", args },
    run: async () => {
      const res = await searchLemma({ ...args, pageSize: MAX_WORD_SAMPLE });
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `lemma:${lemma}`,
        toolName: "searchLemma",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_WORD_SAMPLE)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.morphCode} | ${r.verseText} |`);
      return {
        citations,
        section: sectionBlock(`searchLemma(${label}) — ${res.count} hit(s)`, lines, res.count),
        traces: [{ tool: "searchLemma", args }]
      };
    }
  };
}

function keywordCall(word: string, scope: Scope): PlannedCall {
  const args: { query: string; book?: string; chapter?: number } = { query: word };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const label = `${word}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  return {
    key: `keyword:${word}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchKeyword", args },
    run: async () => {
      const res = await searchKeyword({ ...args, pageSize: MAX_WORD_SAMPLE });
      const total = res.pagination?.total ?? res.results.length;
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `keyword:${word}`,
        toolName: "searchKeyword"
      }));
      const lines = res.results.slice(0, MAX_WORD_SAMPLE).map((r) => `- ${r.reference}, ${r.corpus}: ${r.text}`);
      return {
        citations,
        section: sectionBlock(`searchKeyword(${label})`, lines, total),
        traces: [{ tool: "searchKeyword", args }]
      };
    }
  };
}

function morphCall(code: string, mode: "exact" | "prefix", scope: Scope): PlannedCall {
  const args: { morphCode: string; matchMode: "exact" | "prefix"; book?: string; chapter?: number } = {
    morphCode: code,
    matchMode: mode
  };
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  return {
    key: `morph:${code}|${mode}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchMorphology", args },
    run: async () => {
      const res = await searchMorphology({ ...args, pageSize: MAX_WORD_SAMPLE });
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery: `morph:${code}`,
        toolName: "searchMorphology",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_WORD_SAMPLE)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.lemma} | ${r.morphCode} |`);
      return {
        citations,
        section: sectionBlock(`searchMorphology(${code}, ${mode}) — ${res.count} hit(s)`, lines, res.count),
        traces: [{ tool: "searchMorphology", args }]
      };
    }
  };
}
```

> Note: `searchKeyword`'s result has no `count`; it carries `pagination.total`. The existing test mock returns `pagination: {}`, so the `?? res.results.length` fallback keeps it working.

- [ ] **Step 6: Update `buildPlan` to derive and pass a scope**

`topLemmasCall` is unchanged (it keeps `MAX_SECTION_LINES`). Replace the body of `buildPlan` so it derives a scope and passes it to the word builders (passage handling stays as the existing two `passageCall` lines — Task 3 reworks `passageCall` internally):

```ts
function buildPlan(signals: Signals): PlannedCall[] {
  const calls: PlannedCall[] = [];
  const seen = new Set<string>();
  const add = (call: PlannedCall) => {
    if (seen.has(call.key)) return;
    seen.add(call.key);
    calls.push(call);
  };
  const scope = scopeFor(signals);

  for (const ref of signals.references) {
    add(passageCall("SBLGNT", ref));
    add(passageCall("WEB", ref));
  }

  for (const lemma of signals.greekWords) {
    add(lemmaCall(lemma, scope));
  }

  for (const word of signals.topicWords) {
    const mapped = ENGLISH_TO_GREEK_LEMMA[word];
    if (mapped) add(lemmaCall(mapped, scope));
    else add(keywordCall(word, scope));
  }

  for (const morph of signals.morphCodes) {
    add(morphCall(morph.code, morph.mode, scope));
  }

  if (signals.intent === "topic-survey" && signals.book && calls.length === 0) {
    add(topLemmasCall(signals.book));
  }

  return calls.slice(0, MAX_PLANNED_CALLS);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: PASS — the new scoping/size tests, and the pre-existing tests (they use `expect.objectContaining`, so the added `chapter`/`pageSize` args don't break them). Then `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "$(cat <<'EOF'
Chapter-scope word searches; size-driven completeness (25 + true count)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Full-passage retrieval + cross-chapter assembly + ceiling (`retrievalPlanner.ts`)

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts`
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/ai/retrievalPlanner.test.ts`:

```ts
  it("returns the full chapter for a passage, not a 10-verse slice", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 51 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: `v${i + 1}`
      }))
    }));

    const packet = await runRetrievalPlan({ ...emptySignals, references: [{ book: "John", chapter: 1 }], intent: "passage-study" });

    expect(packet.formattedEvidence).toContain("John 1:14");
    expect(packet.formattedEvidence).toContain("John 1:51");
  });

  it("assembles a cross-chapter passage from per-chapter fetches", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number; verseStart: number }) => ({
      corpus: input.corpus,
      references: [{
        book: input.book, chapter: input.chapter, verse: input.verseStart,
        reference: `${input.book} ${input.chapter}:${input.verseStart}`, text: "t"
      }]
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }],
      intent: "passage-study"
    });

    // Both chapters fetched (per corpus): 4:16 and 5:1
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "SBLGNT", book: "2Cor", chapter: 4, verseStart: 16 }));
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "SBLGNT", book: "2Cor", chapter: 5, verseStart: 1 }));
    expect(packet.formattedEvidence).toContain("2Cor 4:16");
    expect(packet.formattedEvidence).toContain("2Cor 5:1");
  });

  it("caps a pathological passage at the line ceiling with a more-marker", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 200 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: "t"
      }))
    }));

    const packet = await runRetrievalPlan({ ...emptySignals, references: [{ book: "Ps", chapter: 119 }], intent: "passage-study" });

    expect(packet.formattedEvidence).toContain("more)");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: FAIL — passage still slices to 10 (no `John 1:51`); cross-chapter only fetches chapter 4 once and never chapter 5.

- [ ] **Step 3: Add the segment helper**

In `lib/ai/retrievalPlanner.ts`, add above `passageCall`:

```ts
// "to end of chapter" upper bound (no NT chapter exceeds this).
const PASSAGE_CHAPTER_END = 200;

type PassageSegment = { chapter: number; verseStart: number; verseEnd: number };

// Expand a (possibly cross-chapter) reference into single-chapter fetch segments.
function passageSegments(ref: ParsedReference): PassageSegment[] {
  const startChapter = ref.chapter;
  const endChapter = ref.chapterEnd ?? ref.chapter;

  if (endChapter === startChapter) {
    const verseStart = ref.verseStart ?? 1;
    // bare chapter → whole chapter; explicit range → that range; single verse → that verse
    const verseEnd = ref.verseEnd ?? (ref.verseStart === undefined ? PASSAGE_CHAPTER_END : verseStart);
    return [{ chapter: startChapter, verseStart, verseEnd }];
  }

  const segments: PassageSegment[] = [{ chapter: startChapter, verseStart: ref.verseStart ?? 1, verseEnd: PASSAGE_CHAPTER_END }];
  for (let ch = startChapter + 1; ch < endChapter; ch++) {
    segments.push({ chapter: ch, verseStart: 1, verseEnd: PASSAGE_CHAPTER_END });
  }
  segments.push({ chapter: endChapter, verseStart: 1, verseEnd: ref.verseEnd ?? PASSAGE_CHAPTER_END });
  return segments;
}
```

- [ ] **Step 4: Replace `passageCall`**

```ts
function passageCall(corpus: "SBLGNT" | "WEB", ref: ParsedReference): PlannedCall {
  const segments = passageSegments(ref);
  const crossChapter = ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter;
  const label = crossChapter
    ? `${ref.book} ${ref.chapter}:${ref.verseStart ?? 1}-${ref.chapterEnd}:${ref.verseEnd ?? ""}`
    : `${ref.book} ${ref.chapter}`;
  const traces: ToolTraceEntry[] = segments.map((seg) => ({
    tool: "getPassage",
    args: { corpus, book: ref.book, chapter: seg.chapter, verseStart: seg.verseStart, verseEnd: seg.verseEnd }
  }));
  return {
    key: `passage:${corpus}|${ref.book}|${ref.chapter}|${ref.verseStart ?? ""}|${ref.chapterEnd ?? ""}|${ref.verseEnd ?? ""}`,
    errorTrace: { tool: "getPassage", args: { corpus, book: ref.book, chapter: ref.chapter } },
    run: async () => {
      const all: Array<{ book: string; chapter: number; verse: number; reference: string; text: string }> = [];
      for (const seg of segments) {
        const res = await getPassage({ corpus, book: ref.book, chapter: seg.chapter, verseStart: seg.verseStart, verseEnd: seg.verseEnd });
        all.push(...res.references);
      }
      const shown = all.slice(0, MAX_PASSAGE_LINES);
      const citations = shown.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus,
        searchQuery: "passage",
        toolName: "getPassage",
        book: r.book,
        chapter: r.chapter,
        verse: r.verse
      }));
      const lines = shown.map((r) => `- ${r.reference}, ${corpus}: ${r.text}`);
      return {
        citations,
        section: sectionBlock(`getPassage(${label}, ${corpus})`, lines, all.length),
        traces
      };
    }
  };
}
```

- [ ] **Step 5: Update the stale comment in the existing citation-cap test**

In `tests/unit/lib/ai/retrievalPlanner.test.ts`, the test "caps citations per call and overall so consumers' limits are respected" still passes (citations remain capped at `MAX_SECTION_LINES`), but its inline comment is now misleading. Replace:

```ts
    // Each getPassage call contributes a bounded sample, not all 60 verses.
```
with:
```ts
    // Evidence lines may include the full passage, but citations stay capped per call.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: PASS (new passage tests + all pre-existing). Then `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "$(cat <<'EOF'
Return full passages; assemble cross-chapter ranges; add line ceiling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Docs + full verification

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `ReadMe.md`

- [ ] **Step 1: Run the full gate**

Run (PowerShell): `$env:NODE_OPTIONS="--use-system-ca"; npm run verify`
Expected: lint + tsc + build + coverage gate all green (80/80/75/65). If a branch-coverage dip appears, add a targeted test for any uncovered branch in `scopeFor`/`passageSegments` before proceeding.

- [ ] **Step 2: Update PROJECT_STATE**

In `docs/PROJECT_STATE.md`, in the assistant-pipeline section (the numbered retrieval-first contract), note that step 2 (retrieval planning) now: scopes word searches to a named chapter; returns bounded scopes in full and samples large scopes at 25 + true count; returns full passages including cross-chapter ranges. Add the new test surfaces (signals cross-chapter parsing; planner scoping/size/passage tests).

- [ ] **Step 3: Update README**

In `ReadMe.md`, add a one-line note to the assistant/retrieval description: the planner scopes searches to the named book/chapter, returns whole chapters (and cross-chapter passages) in full, and samples large surveys with a true-count marker.

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_STATE.md ReadMe.md
git commit -m "$(cat <<'EOF'
Document retrieval scoping & completeness changes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Section 0 cross-chapter parsing → Task 1.
- Section 1 chapter-scope word searches → Task 2 (`scopeFor`, builder `scope` param).
- Section 2 size-driven completeness (≤25 all / >25 25+count) → Task 2 (`MAX_WORD_SAMPLE`, `sectionBlock` total = `res.count`).
- Section 3 full passages + cross-chapter split/merge + ceiling → Task 3 (`passageSegments`, `passageCall`, `MAX_PASSAGE_LINES`).
- Section 4 citations bounded, evidence grows → Task 2/3 (`MAX_SECTION_LINES` kept at 10 for citations; `MAX_TOTAL_CITATIONS` unchanged).
- Section 5 data flow → unchanged orchestration.
- Testing strategy → Tasks 1–3 tests; docs → Task 4.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `Scope` (`{book?, chapter?}`) defined in Task 2 and used by all three word builders; `PassageSegment`/`passageSegments` defined and consumed in Task 3; `ParsedReference.chapterEnd` defined in Task 1 and read by `scopeFor` (Task 2) and `passageSegments` (Task 3). `MAX_SECTION_LINES` is **not** renamed — it stays as the per-call citation cap and is referenced by the word builders, `passageCall`, and `topLemmasCall` throughout; `MAX_WORD_SAMPLE`/`MAX_PASSAGE_LINES` are added in Task 2's constants block and used for evidence lines in Tasks 2–3. No intermediate broken state (the constant is never removed).
