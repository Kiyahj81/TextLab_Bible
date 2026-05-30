# Retrieval Scoping & Completeness Fix (Design)

*Status:* Approved for implementation · *Date:* 2026-05-30 · *Branch:* `fix/retrieval-scoping` (off `main`)
*Related:* Milestone 3 Phase 1 (Paradigm C planner) and Phase 2 (Grounding), both shipped on `main`.

## Problem

The assistant answers whole-chapter and word-study questions from an incomplete slice of the corpus,
producing answers that are confidently wrong. Observed: "Show me every use of *logos* in John 1 and
summarize the pattern" analyzed only John 1:1 and missed 1:14 ("the Word became flesh"). Two root causes
in `lib/ai/retrievalPlanner.ts`:

1. **Passages are truncated to the first 10 verses.** `passageCall` fetches the whole chapter but slices
   to `MAX_SECTION_LINES = 10`. For John 1 (51 verses) the model saw only 1:1–1:10, read it narratively,
   and concluded λόγος occurs only in v.1.
2. **Word searches ignore the named chapter.** `lemmaCall`/`keywordCall`/`morphCall` are scoped to
   `signals.book` only (the whole book), never the chapter the user named — and then capped at 10. So
   "logos in John 1" searched all of John (~35 hits) and sampled 10, instead of returning the 2
   occurrences actually in chapter 1.

A third gap surfaced during design: **cross-chapter passages** (e.g. `2 Cor 4:16–5:10`) are *double-broken*
— the reference regex mis-parses `4:16–5:10` as `{ch 4, vs 16, verseEnd 5}` (a nonsensical 16→5 range,
`:10` dangling), and `getPassage` is single-chapter only — so they return empty evidence today. This is in
scope for this fix.

## Guiding principle (locked)

> **Scope searches to the location the user named. Within a *bounded* scope (a named chapter, a verse
> range, or a single-chapter book) return everything. For an *unbounded* scope (a multi-chapter book or
> corpus-wide) return a 25-item sample plus the true total count.**

"Bounded vs. large" is decided **by the actual result size (Option A, data-driven)**, not by classifying
the named scope syntactically: run the (scoped) search, and if the real `count` is `≤ 25` show all, else
show 25 + the true count. This needs no book-structure metadata and handles chapters, ranges, and
single-chapter books (Jude, Philemon, 2/3 John) uniformly, because each yields a small `count`.

## Out of scope (deferred, not cancelled)

- **Book-group scoping** ("the Gospels", "Paul's letters", "the NT") — recognizing group terms and
  threading a multi-book filter through the search layer. Its own future spec.
- Any change to `lib/search.ts` function signatures. `searchLemma`/`searchKeyword`/`searchMorphology`
  already accept `chapter`; `getPassage` stays single-chapter (cross-chapter is handled by the planner).

## Scope of changes

| File | Change |
|---|---|
| `lib/ai/signals.ts` | Parse cross-chapter references; add `chapterEnd?` to `ParsedReference`. |
| `lib/ai/retrievalPlanner.ts` | Chapter-scope word searches; size-driven completeness; full-passage (incl. cross-chapter split+merge) with a safety ceiling. |

No schema, migration, or `search.ts` signature change.

---

## Section 0 — Cross-chapter reference parsing (`signals.ts`)

`ParsedReference` gains an optional `chapterEnd`:

```ts
export type ParsedReference = {
  book: string;
  chapter: number;        // start chapter
  verseStart?: number;
  verseEnd?: number;      // end verse (in chapterEnd if present, else in chapter)
  chapterEnd?: number;    // present only for a cross-chapter range
};
```

`REFERENCE_REGEX` is extended so the dash-range may carry an optional end chapter:

- `John 1:1` → `{ book:"John", chapter:1, verseStart:1 }`
- `John 1` → `{ book:"John", chapter:1 }` (bare chapter, unchanged)
- `Rom 8:1-4` → `{ book:"Rom", chapter:8, verseStart:1, verseEnd:4 }` (same-chapter range, unchanged)
- `2 Cor 4:16-5:10` → `{ book:"2Cor", chapter:4, verseStart:16, chapterEnd:5, verseEnd:10 }`

Regex sketch (the end-verse group gains an optional `(\d+):` end-chapter prefix):

```
(?<![a-z0-9])(alias)\s+(\d+)(?::(\d+)(?:\s*[-–—]\s*(?:(\d+):)?(\d+))?)?
                groups: 1=alias 2=chapter 3=verseStart 4=chapterEnd? 5=verseEnd?
```

If group 4 (end chapter) is present, set `chapterEnd`; otherwise the range stays within `chapter`. Existing
single-chapter behavior is unchanged. Malformed input still yields no reference.

---

## Section 1 — Scope word searches to the named chapter (`retrievalPlanner.ts`)

`buildPlan` derives an optional **scope chapter** and threads it into the word-search builders
(`lemmaCall`, `keywordCall`, `morphCall`), which already pass `book` to `searchLemma`/`searchKeyword`/
`searchMorphology` (all of which accept `chapter`).

Derivation rule:
- Exactly **one** reference whose span is a **single chapter** (`chapterEnd` absent or equal to `chapter`)
  → scope chapter = that `chapter` (and its `book`).
- A **cross-chapter** reference, **multiple** references, or **no** reference → no chapter scope; fall back
  to `signals.book` (today's behavior), or corpus-wide if no book.

Effect: "logos in John 1" → `searchLemma(λόγος, { book:"John", chapter:1 })` → 2 hits (1:1, 1:14).
"logos in John" → book-scoped (chapter undefined) → the size rule (Section 2) applies.

---

## Section 2 — Size-driven completeness for word searches

Replace the flat `MAX_SECTION_LINES = 10` slice (in the word-search builders) with a size rule keyed on the
real total `count` the search already returns:

- `count ≤ 25` → emit **all** rows (citations + evidence lines).
- `count > 25` → emit the first **25** rows + the existing `…(N more)` marker; the section heading keeps
  showing the true `count` (e.g. `searchLemma(ἀγάπη) — 116 hit(s)`).

Mechanical: raise each word search's `pageSize` to **≥ 25** (currently lemma 20 / keyword 10 / morph 20) so
25 rows are available to display. Introduce a named constant (e.g. `MAX_WORD_SAMPLE = 25`) replacing the
per-word use of `MAX_SECTION_LINES`.

`getTopLemmas`/`findLemmaExamples` (the `topic-survey` branch) keep their current small per-lemma caps —
they are a different, already-bounded shape and out of this rule's concern.

---

## Section 3 — Passages return the whole requested span

`passageCall` stops slicing to `MAX_SECTION_LINES`:

- **Single chapter** (`John 1`) or **in-chapter range** (`Rom 8:1-4`) → return the full chapter / range.
- **Cross-chapter range** (`chapterEnd` present) → the planner splits the span into per-chapter
  `getPassage` calls and merges them into **one section per corpus**:
  - first chapter: `verseStart … (end of chapter)` — fetched via the existing high upper-bound (e.g. 200),
  - any whole middle chapters: `1 … (end)`,
  - last chapter: `1 … verseEnd`.
- **Both corpora** (SBLGNT + WEB) are fetched at full length (confirmed default). This doubles the passage
  payload for a chapter but gives the model complete Greek evidence and readable English for the passage the
  user explicitly asked about.
- **Hard safety ceiling** `MAX_PASSAGE_LINES` (≈ 120 verses per corpus across the whole span). No real NT
  chapter or normal pericope approaches this; it only stops a pathological whole-book range (`John 1:1-21:25`)
  from exploding the payload. When the ceiling truncates, append the `…(N more)` marker so it stays honest.

`getPassage` itself is unchanged; cross-chapter assembly lives entirely in the planner.

---

## Section 4 — Caps (evidence vs. citations)

Decouple the **evidence text** (what the model reasons over) from the **citations list** (UI gutter +
grounding linkage):

- Evidence text grows per Sections 2–3 (complete where bounded).
- **Citations stay bounded.** Keep `MAX_TOTAL_CITATIONS` ≈ 40 (aligned with the save-note cap of 50) and
  leave the synthesis 20-citation JSON slice unchanged. Rationale: the true-count headings keep sampling
  honest, and under Phase 2 live grounding the model cites from its **own verified claims** (validated
  against the DB), not from this array — so a bounded citation list does not limit what it can cite, while
  an unbounded one would bloat the payload and overflow the note-save cap.

This is the confirmed default: only the evidence the model reasons over is made complete; citations are not
ballooned.

---

## Section 5 — Data flow (end to end)

```
prompt
  → extractSignals            (Section 0: references incl. chapterEnd; book; greek/topic words)
  → buildPlan                 (Section 1: derive scope chapter; Sections 2–3: per-call shaping)
      passageCall(s)          full chapter / cross-chapter split+merge, both corpora, ceiling
      lemma/keyword/morphCall chapter-scoped when bounded; size rule (≤25 all / >25 sample+count)
  → runRetrievalPlan          assembles EvidencePacket (citations ≤ MAX_TOTAL_CITATIONS, formattedEvidence)
  → synthesis / fallback      unchanged
```

## Testing strategy (TDD)

**`signals` parsing** (`tests/unit/lib/ai/signals.test.ts`, extend):
- `John 1:1`, `John 1` (bare chapter), `Rom 8:1-4` (same-chapter range), `2 Cor 4:16-5:10` (cross-chapter →
  `chapterEnd:5, verseEnd:10`), `1 John 2:23` (numbered book), malformed → no reference.

**Planner scoping & completeness** (`tests/unit/lib/ai/retrievalPlanner.test.ts`, extend; DB mocked):
- "logos in John 1" → lemma call invoked with `chapter: 1`.
- "logos in John" → lemma call invoked with no `chapter`.
- Two references → word searches not chapter-scoped.
- Cross-chapter reference → word search falls back to book scope.
- Size rule: a search returning `count ≤ 25` emits all rows; `count > 25` emits 25 rows + the true count in
  the heading and a `…(N more)` marker.
- Passage, single chapter of 51 verses → all 51 emitted (not 10).
- Passage, cross-chapter `2 Cor 4:16-5:10` → split into `4:16→200` + `5:1→10`, merged into one section per
  corpus, covering both chapters.
- Passage ceiling: a pathological large range is capped at `MAX_PASSAGE_LINES` with a `…(N more)` marker.

**Regression:** update existing `retrievalPlanner` tests that assert the old 10-line slicing.

## Verification (Definition of Done)

- `npm run verify` (lint + tsc + build + coverage gate 80/80/75/65) exits 0.
- Manual (live mode): "Show me every use of logos in John 1 and summarize the pattern" surfaces **both**
  1:1 and 1:14; "summarize 2 Cor 4:16–5:10" returns text spanning both chapters; a broad survey
  ("ἀγάπη in the NT") shows 25 examples with the true total.

## Files touched

- **Modify:** `lib/ai/signals.ts` (regex + `chapterEnd`), `lib/ai/retrievalPlanner.ts` (scoping, size rule,
  passage assembly + ceiling, new constants `MAX_WORD_SAMPLE`, `MAX_PASSAGE_LINES`).
- **Docs (per CLAUDE.md):** update `docs/PROJECT_STATE.md` and `ReadMe.md` after implementation;
  `docs/security-register.md` only if a security-relevant change lands (none expected).

## Deferred follow-ups

- Book-group scoping ("the Gospels", "Paul", "the NT").
- Verse-range-precise word scoping (today a cross-chapter or in-chapter range scopes word searches at chapter
  granularity, falling back to book for cross-chapter).
- Single-chapter-book verse references — `Jude 3`/`Phlm 6` mean *verse* 3/6 but the regex parses them as
  *chapter* 3/6 (which don't exist). A pre-existing quirk, orthogonal to this fix; left as-is here.
