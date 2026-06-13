# English Keyword Stemming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** English (WEB) keyword search stems — `love` matches `loves/loved/loving`, not `beloved` — with result highlighting that tracks the stemmer, while SBLGNT Greek keyword matching stays exact whole-lexeme.

**Architecture:** A new immutable `bible_english` text-search config (unaccent + Snowball `english_stem`) feeds a second STORED generated tsvector column `Verse.textSearchEn`. `searchKeyword` uses one unified language-routed predicate (per row, by `Corpus.language`) — English rows match/rank/highlight via `bible_english`/`textSearchEn`, Greek rows via the existing `bible_simple`/`textSearch`. The assistant's `searchSemantic` keyword FTS leg (WEB-only) is switched to `bible_english`/`textSearchEn` too, so every English keyword path stems. Highlighting comes from `ts_headline` (same config that matched), parsed from sentinel markup into the existing `HighlightSegment[]` shape and rendered in `SearchPanel`.

**Tech Stack:** Postgres FTS (`tsvector`, `to_tsvector`, `websearch_to_tsquery`, `ts_headline`, `english_stem`, `unaccent`), Prisma 6 raw SQL, Next 15 / React 19, Vitest 4 (+ jsdom/RTL), Neon branches.

**Spec:** `docs/superpowers/specs/2026-06-13-english-keyword-stemming-design.md`

**Process rules:**
- Single PR on branch `feat/english-keyword-stemming` (the spec already lives on this branch).
- Never run `prisma migrate dev` on this repo (autocrlf false-drift) — migrations are handwritten and applied with `migrate deploy`.
- `npm run verify` + `npm run test:integration` green before push. After opening the PR, **stop and wait** for maintainer review/merge (including Codex/CodeRabbit comments).

**Sentinel convention (used in Tasks 3–6):** the `ts_headline` highlight delimiters are the Private-Use-Area code points `U+E000` (start) and `U+E001` (end). The plan defines them in source with `String.fromCharCode(0xe000)` / `String.fromCharCode(0xe001)` so there are no invisible literals to copy — use that form verbatim.

---

### Task 1: Handwritten migration — `bible_english` config + `textSearchEn` column + index

**Files:**
- Create: `prisma/migrations/20260613120000_english_stem_fts/migration.sql`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Confirm you are on the feature branch**

Run: `git branch --show-current`
Expected: `feat/english-keyword-stemming`. If not: `git checkout feat/english-keyword-stemming`.

- [ ] **Step 2: Add CA-wrapped npm scripts for the commands this plan uses**

This repo wraps every Node/Prisma command with `NODE_OPTIONS=--use-system-ca` via `cross-env`
(a bare `cross-env …` won't resolve on PATH). `prisma:generate` already exists; add two more
to `package.json` `scripts`, alongside `db:migrate:deploy` (line ~22):

```json
    "prisma:migrate:status": "cross-env NODE_OPTIONS=--use-system-ca prisma migrate status",
    "db:migrate:deploy:test": "cross-env NODE_OPTIONS=--use-system-ca node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy",
```

`db:migrate:deploy:test` mirrors how `test:integration` invokes its tool under `.env.test`
(`node --env-file=.env.test node_modules/<tool>`), pointing `prisma migrate deploy` at the
test/eval Neon branch.

- [ ] **Step 3: Create the migration SQL**

```sql
-- English Snowball stemming for keyword search (WEB only).
-- Mirrors the bible_simple recipe (20260530120000_lexical_fts) but ends the
-- mapping in english_stem so English inflections share a stem. Greek keeps
-- bible_simple via the existing textSearch column.

-- 1. Immutable English config: clone `english` (keeps its token mappings and the
--    Snowball stopword handling), then route word-bearing tokens through
--    unaccent -> english_stem. Wiring unaccent in as a dictionary is what keeps
--    to_tsvector('bible_english', text) IMMUTABLE (required by a generated column).
DROP TEXT SEARCH CONFIGURATION IF EXISTS bible_english;
CREATE TEXT SEARCH CONFIGURATION bible_english (COPY = english);
ALTER TEXT SEARCH CONFIGURATION bible_english
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, english_stem;

-- 2. Second generated tsvector column (STORED backfills all rows on creation).
ALTER TABLE "Verse"
  ADD COLUMN "textSearchEn" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_english', "text")) STORED;

-- 3. GIN index for fast @@ matching on the English column.
CREATE INDEX "Verse_textSearchEn_idx" ON "Verse" USING GIN ("textSearchEn");
```

- [ ] **Step 4: Apply to the dev/prod Neon branch (ep-tiny-queen via `.env`)**

Run: `npm run db:migrate:deploy`
Expected: Prisma reports `1 migration applied` (`20260613120000_english_stem_fts`) and `All migrations have been successfully applied.` (If TLS error: the shell needs `NODE_OPTIONS=--use-system-ca`; the script bakes it in, but `npm install` must have run in an armed shell.)

- [ ] **Step 5: Verify status is clean**

Run: `npm run prisma:migrate:status`
Expected: lists `20260613120000_english_stem_fts` among applied; ends `Database schema is up to date!`

- [ ] **Step 6: Smoke-check the config in SQL (optional but fast)**

Run (psql or any SQL console against the dev branch):
```sql
SELECT to_tsvector('bible_english', 'loved loving loves beloved');
```
Expected: `loved`/`loving`/`loves` collapse to one `love` lexeme, while `beloved` has its own distinct stem — confirming stemming + separation.

- [ ] **Step 7: Commit**

```bash
git add package.json prisma/migrations/20260613120000_english_stem_fts/migration.sql
git commit -m "Add bible_english FTS config, textSearchEn column, and CA-wrapped migrate scripts"
```

### Task 2: Declare `textSearchEn` in the Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:53-74` (the `Verse` model)

- [ ] **Step 1: Add the column declaration and index**

In the `Verse` model, after the existing `textSearch` field (line 63) add:

```prisma
  /// English-stemmed FTS vector (generated column, bible_english config).
  /// Never read through the typed client — keyword matching uses $queryRaw.
  /// Declared so Prisma drift detection accounts for the column.
  textSearchEn Unsupported("tsvector")?
```

And after the existing `@@index([textSearch], type: Gin)` (line 73) add:

```prisma
  @@index([textSearchEn], type: Gin)
```

- [ ] **Step 2: Regenerate the client and confirm no drift**

Run: `npm run prisma:generate`
Then: `npm run prisma:migrate:status`
Expected: generate succeeds; status still `Database schema is up to date!` (the schema now matches the migrated DB).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Declare textSearchEn column in the Prisma schema"
```

### Task 3: Headline sentinel parser (`parseHeadlineSegments`)

**Files:**
- Modify: `lib/search-highlight.ts`
- Test: `tests/unit/lib/search-highlight.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/search-highlight.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHeadlineSegments, HEADLINE_OPTIONS } from "@/lib/search-highlight";

const S = String.fromCharCode(0xe000); // StartSel (U+E000)
const E = String.fromCharCode(0xe001); // StopSel  (U+E001)

describe("parseHeadlineSegments", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseHeadlineSegments("")).toEqual([]);
  });

  it("returns a single text segment when there are no sentinels", () => {
    expect(parseHeadlineSegments("In the beginning")).toEqual([
      { kind: "text", value: "In the beginning" }
    ]);
  });

  it("splits a marked word into text/match/text", () => {
    expect(parseHeadlineSegments(`God so ${S}loved${E} the world`)).toEqual([
      { kind: "text", value: "God so " },
      { kind: "match", value: "loved" },
      { kind: "text", value: " the world" }
    ]);
  });

  it("handles a leading match with no preceding text", () => {
    expect(parseHeadlineSegments(`${S}Love${E} is patient`)).toEqual([
      { kind: "match", value: "Love" },
      { kind: "text", value: " is patient" }
    ]);
  });

  it("handles adjacent matches", () => {
    expect(parseHeadlineSegments(`${S}a${E}${S}b${E}`)).toEqual([
      { kind: "match", value: "a" },
      { kind: "match", value: "b" }
    ]);
  });

  it("exposes ts_headline options using the same sentinels it parses", () => {
    expect(HEADLINE_OPTIONS).toContain("HighlightAll");
    expect(HEADLINE_OPTIONS).toContain(S);
    expect(HEADLINE_OPTIONS).toContain(E);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/search-highlight.test.ts`
Expected: FAIL — `parseHeadlineSegments` / `HEADLINE_OPTIONS` not exported.

- [ ] **Step 3: Implement in `lib/search-highlight.ts`**

Append to the file (after the existing `splitWithMatches`):

```typescript
// ts_headline sentinels. Private-Use-Area code points (U+E000 / U+E001) that
// cannot appear in WEB or SBLGNT verse text, so splitting the headline back
// into segments is unambiguous. HEADLINE_OPTIONS is passed to ts_headline; the
// same sentinels are parsed out here. Defined via fromCharCode to keep the
// source free of invisible literals.
const HL_START = String.fromCharCode(0xe000);
const HL_END = String.fromCharCode(0xe001);

export const HEADLINE_OPTIONS = `HighlightAll=TRUE, StartSel=${HL_START}, StopSel=${HL_END}`;

export function parseHeadlineSegments(headline: string): HighlightSegment[] {
  if (!headline) return [];
  const pattern = new RegExp(`${HL_START}([\\s\\S]*?)${HL_END}`, "g");
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const hit of headline.matchAll(pattern)) {
    const index = hit.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", value: headline.slice(cursor, index) });
    }
    segments.push({ kind: "match", value: hit[1] });
    cursor = index + hit[0].length;
  }
  if (cursor < headline.length) {
    segments.push({ kind: "text", value: headline.slice(cursor) });
  }
  return segments;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/search-highlight.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/search-highlight.ts tests/unit/lib/search-highlight.test.ts
git commit -m "Add ts_headline sentinel parser for stem-aware highlighting"
```

### Task 4: Route `searchKeyword` by language + `ts_headline`, and stem the semantic FTS leg

**Files:**
- Modify: `lib/search.ts` (imports near line 1-9; `searchKeyword` body, lines ~426-528; `searchSemantic` FTS leg, lines ~147-158)
- Test: `tests/unit/lib/search-keyword.test.ts` (extend + update one existing assertion); `tests/unit/lib/search-semantic.test.ts` (extend)

- [ ] **Step 1: Write the new failing tests**

Add these to `tests/unit/lib/search-keyword.test.ts` inside the `describe("searchKeyword FTS", …)` block:

```typescript
  it("uses one language-routed predicate carrying both configs (no-corpus default)", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "love" });
    const sql = sqlTextFrom(prismaMock.$queryRaw.mock.calls[0]);
    // Unified predicate: both branches present regardless of corpus; the row's
    // language picks which one can match.
    expect(sql).toContain("bible_english");
    expect(sql).toContain("textsearchen");
    expect(sql).toContain("bible_simple");
    // Unquoted: sqlTextFrom JSON.stringifies the call, so the identifier
    // `c."language"` serializes as `c.\"language\"` — match the bare word.
    expect(sql).toContain("language");
  });

  it("narrows by abbreviation when an explicit corpus is given", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([]);
    await searchKeyword({ query: "love", corpus: "WEB" });
    const sql = sqlTextFrom(prismaMock.$queryRaw.mock.calls[0]);
    // The corpus filter narrows rows; the unified predicate still carries both
    // branches (the WEB rows only match the bible_english branch).
    expect(sql).toContain("abbreviation");
    expect(sql).toContain("web");
    expect(sql).toContain("bible_english");
  });

  it("parses the per-row headline into highlightSegments", async () => {
    const S = String.fromCharCode(0xe000);
    const E = String.fromCharCode(0xe001);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(1) }])
      .mockResolvedValueOnce([
        {
          corpus: "WEB",
          osisId: "John",
          chapter: 3,
          verse: 16,
          text: "For God so loved the world",
          headline: `For God so ${S}loved${E} the world`
        }
      ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 3, verse: 16, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "love", corpus: "WEB" });
    expect(out.results[0].highlightSegments).toEqual([
      { kind: "text", value: "For God so " },
      { kind: "match", value: "loved" },
      { kind: "text", value: " the world" }
    ]);
  });
```

Then **update the existing** "issues a count query and a rows query" test so its mock rows carry a `headline` and its expected results include `highlightSegments`. Replace that test body's mock-rows and assertion with:

```typescript
    const S = String.fromCharCode(0xe000);
    const E = String.fromCharCode(0xe001);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος", headline: `Ἐν ἀρχῇ ἦν ὁ ${S}λόγος${E}` },
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 14, text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", headline: `Καὶ ὁ ${S}λόγος${E} σὰρξ ἐγένετο` }
      ]);
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } },
      { chapter: 1, verse: 14, book: { osisId: "John" } }
    ]);

    const out = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out.pagination.total).toBe(2);
    expect(out.results).toEqual([
      { corpus: "SBLGNT", reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος", onSpine: true,
        highlightSegments: [
          { kind: "text", value: "Ἐν ἀρχῇ ἦν ὁ " },
          { kind: "match", value: "λόγος" }
        ] },
      { corpus: "SBLGNT", reference: "John 1:14", text: "Καὶ ὁ λόγος σὰρξ ἐγένετο", onSpine: true,
        highlightSegments: [
          { kind: "text", value: "Καὶ ὁ " },
          { kind: "match", value: "λόγος" },
          { kind: "text", value: " σὰρξ ἐγένετο" }
        ] }
    ]);
```

In the other existing tests whose mock rows feed the results mapping (the `onSpine` test and the two `withEnglish` tests), add a `headline` field to each mock row equal to its `text` (no sentinels → a single text segment, which those tests ignore via `toMatchObject` / `find`). This keeps them valid without asserting on segments.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/search-keyword.test.ts`
Expected: FAIL — `searchKeyword` doesn't yet route by language, emit a headline, or return `highlightSegments`.

- [ ] **Step 3: Update the imports in `lib/search.ts`**

Add to the import block near the top (after line 9):

```typescript
import { parseHeadlineSegments, HEADLINE_OPTIONS } from "@/lib/search-highlight";
```

- [ ] **Step 4: Replace the query-assembly and execution in `searchKeyword`**

Replace the block from the `const tsquery = …` line through the end of the `Promise.all([...])` (current lines ~445-488) with:

```typescript
  // Each row matches under its own language config: English (WEB) rows are
  // stemmed via bible_english; Greek rows keep whole-lexeme bible_simple.
  // websearch_to_tsquery never throws on arbitrary input; all values bound.
  const enQuery = Prisma.sql`websearch_to_tsquery('bible_english', ${query})`;
  const grQuery = Prisma.sql`websearch_to_tsquery('bible_simple', ${query})`;

  const matchSql = Prisma.sql`(
    (c."language" = 'English' AND v."textSearchEn" @@ ${enQuery})
    OR
    (c."language" <> 'English' AND v."textSearch" @@ ${grQuery})
  )`;

  // Corpus filter mirrors prior behavior: explicit corpus, else any but NET.
  const corpusFilter = input.corpus
    ? Prisma.sql`c."abbreviation" = ${input.corpus}`
    : Prisma.sql`c."abbreviation" <> 'NET'`;

  const filters: Prisma.Sql[] = [matchSql, corpusFilter];
  if (book) filters.push(Prisma.sql`b."osisId" = ${book}`);
  if (input.chapter !== undefined) filters.push(Prisma.sql`v."chapter" = ${input.chapter}`);
  const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

  // Rank by whichever column/config matched the row.
  const rankSql = Prisma.sql`(CASE WHEN c."language" = 'English'
    THEN ts_rank(v."textSearchEn", ${enQuery})
    ELSE ts_rank(v."textSearch", ${grQuery}) END)`;
  const orderSql =
    input.orderBy === "rank"
      ? Prisma.sql`ORDER BY ${rankSql} DESC, b."order" ASC, v."chapter" ASC, v."verse" ASC`
      : Prisma.sql`ORDER BY b."order" ASC, v."chapter" ASC, v."verse" ASC`;

  // Per-row stem-aware highlight markup, same config that matched the row.
  // HighlightAll=TRUE returns the whole verse (not a snippet); sentinels are
  // parsed back into HighlightSegment[] by parseHeadlineSegments.
  const headlineSql = Prisma.sql`CASE WHEN c."language" = 'English'
    THEN ts_headline('bible_english', v."text", ${enQuery}, ${HEADLINE_OPTIONS})
    ELSE ts_headline('bible_simple', v."text", ${grQuery}, ${HEADLINE_OPTIONS}) END`;

  const offset = (pagination.page - 1) * pagination.pageSize;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM "Verse" v
      JOIN "Corpus" c ON c."id" = v."corpusId"
      JOIN "Book" b ON b."id" = v."bookId"
      ${whereSql}
    `),
    prisma.$queryRaw<
      { corpus: string; osisId: string; chapter: number; verse: number; text: string; headline: string }[]
    >(Prisma.sql`
      SELECT c."abbreviation" AS corpus, b."osisId" AS "osisId",
             v."chapter" AS chapter, v."verse" AS verse, v."text" AS text,
             ${headlineSql} AS headline
      FROM "Verse" v
      JOIN "Corpus" c ON c."id" = v."corpusId"
      JOIN "Book" b ON b."id" = v."bookId"
      ${whereSql}
      ${orderSql}
      LIMIT ${pagination.pageSize} OFFSET ${offset}
    `)
  ]);
```

- [ ] **Step 5: Add `highlightSegments` to each result in the return mapping**

In the `results: rows.map((row) => ({ … }))` block (current lines ~518-526), add the field after `onSpine`:

```typescript
      onSpine: spine.has(spineKey(row.osisId, row.chapter, row.verse)),
      highlightSegments: parseHeadlineSegments(row.headline),
```

(Leave the `text` field and the `withEnglish` spread exactly as they are — `text` is still consumed by the assistant retrieval planner, which ignores the new field.)

- [ ] **Step 6: Run unit tests + typecheck**

Run: `npx vitest run tests/unit/lib/search-keyword.test.ts` then `npx tsc --noEmit --pretty false`
Expected: PASS (all keyword tests, including the new routing, explicit-corpus, and headline-parse tests) / exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/search.ts tests/unit/lib/search-keyword.test.ts
git commit -m "Route keyword search by language with ts_headline highlighting"
```

- [ ] **Step 8: Write the failing test for the semantic FTS leg**

The assistant's `searchSemantic` has its own keyword FTS leg (a separate inline `$queryRaw`,
not routed through `searchKeyword`). It is WEB-only (`SEMANTIC_INDEX_CORPUS = "WEB"`), so it
must use `bible_english`/`textSearchEn` for consistency. The suite already has a test
"also runs the FTS half when keywords are supplied" where the FTS query is the **2nd**
`$queryRaw` call (vector is 1st). Mirror that test's mock setup and add, inside
`describe("searchSemantic", …)` in `tests/unit/lib/search-semantic.test.ts`:

```typescript
  it("uses bible_english/textSearchEn for the WEB keyword FTS leg", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ osisId: "John", chapter: 1, verse: 1, text: "In the beginning" }]) // vector
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]); // FTS
    prismaMock.verse.findMany.mockResolvedValueOnce([]); // filterToSblSpine
    rerankCandidatesMock.mockResolvedValueOnce(null);

    await searchSemantic({ query: "reconciliation", keywords: "reconciliation" });

    // The FTS leg is the 2nd $queryRaw call; flatten its SQL fragments to a string.
    const ftsSql = JSON.stringify(prismaMock.$queryRaw.mock.calls[1]).toLowerCase();
    expect(ftsSql).toContain("bible_english");
    expect(ftsSql).toContain("textsearchen");
    expect(ftsSql).not.toContain("bible_simple");
  });
```

> Reuse the suite's existing `fakeClient` helper and mock shapes (copy them from the
> "also runs the FTS half when keywords are supplied" test). The assertion targets the FTS
> leg's SQL (`calls[1]`), not the vector leg.

Run: `npx vitest run tests/unit/lib/search-semantic.test.ts`
Expected: FAIL — the leg still emits `bible_simple`/`textSearch`.

- [ ] **Step 9: Stem the semantic FTS leg in `lib/search.ts`**

In `searchSemantic` (the `if (keywords) { … }` block, ~lines 147-158), change the FTS leg from
`bible_simple`/`textSearch` to `bible_english`/`textSearchEn` (the leg is unconditionally WEB,
so no language routing):

```typescript
    const tsquery = Prisma.sql`websearch_to_tsquery('bible_english', ${keywords})`;
    ftsRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
      SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Book" b ON b."id" = v."bookId"
      JOIN "Corpus" c ON c."id" = v."corpusId"
      WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} ${bookFilter} ${chapterFilter}
        AND v."textSearchEn" @@ ${tsquery}
      ORDER BY ts_rank(v."textSearchEn", ${tsquery}) DESC
      LIMIT ${POOL}
    `);
```

(Only the config name and the two `textSearch` → `textSearchEn` references change; the vector
leg, RRF, SBL-spine filter, and rerank are untouched.)

Also update the now-stale comment above `searchSemantic` (currently ~line 79): it says
`bible_simple keeps stopwords, so the full prompt would AND to nothing`, which is wrong once the
leg uses `bible_english` (English stemming **drops** stopwords). Replace that clause:

```typescript
// natural-language prompt); `keywords` drives the FTS half (distilled topic words,
// not the full prompt, whose many content words would AND to nothing). The FTS half
// uses the bible_english config (English stemming, consistent with searchKeyword).
// Returns [] when no OpenAI client (embedQuery null).
```

- [ ] **Step 10: Run the semantic tests + typecheck**

Run: `npx vitest run tests/unit/lib/search-semantic.test.ts` then `npx tsc --noEmit --pretty false`
Expected: PASS (including the new assertion and the existing no-key/disabled/fusion tests) / exit 0.

- [ ] **Step 11: Commit**

```bash
git add lib/search.ts tests/unit/lib/search-semantic.test.ts
git commit -m "Stem the assistant semantic FTS leg (bible_english) for consistency"
```

### Task 5: Render `highlightSegments` in `SearchPanel`

**Files:**
- Modify: `components/SearchPanel.tsx` (import ~line 6; `SearchPanelResult` keyword variant lines 77-85; keyword render branch line 558; new `KeywordHighlight` helper near `HighlightedText` line 705)
- Test: `tests/unit/components/SearchPanel-highlight.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/SearchPanel-highlight.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeywordHighlight } from "@/components/SearchPanel";

describe("KeywordHighlight", () => {
  it("renders match segments as <mark> when highlightSegments is present", () => {
    render(
      <KeywordHighlight
        segments={[
          { kind: "text", value: "God so " },
          { kind: "match", value: "loved" },
          { kind: "text", value: " the world" }
        ]}
        text="God so loved the world"
        query="love"
      />
    );
    const mark = screen.getByText("loved");
    expect(mark.tagName).toBe("MARK");
  });

  it("falls back to literal-substring highlighting when segments are absent", () => {
    render(<KeywordHighlight text="God so loved the world" query="love" />);
    // "love" is a substring of "loved" → the fallback marks it.
    const mark = screen.getByText("love");
    expect(mark.tagName).toBe("MARK");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel-highlight.test.tsx`
Expected: FAIL — `KeywordHighlight` is not exported from `@/components/SearchPanel`.

- [ ] **Step 3: Import the segment type**

In `components/SearchPanel.tsx`, update the highlight import (line 6) to also pull the type:

```typescript
import { splitWithMatches, type HighlightSegment } from "@/lib/search-highlight";
```

(`HighlightSegment` is already declared `export type` at the top of `lib/search-highlight.ts`, so no change is needed there.)

- [ ] **Step 4: Add `highlightSegments` to the keyword result type**

In the `SearchPanelResult` union, the `kind: "keyword"` branch (lines 78-85) gains the field:

```typescript
  | {
      kind: "keyword";
      corpus: string;
      reference: string;
      text: string;
      onSpine?: boolean;
      englishText?: string;
      highlightSegments?: HighlightSegment[];
    }
```

- [ ] **Step 5: Add the `KeywordHighlight` helper**

Next to `HighlightedText` (after its definition, ~line 723) add:

```tsx
export function KeywordHighlight({
  segments,
  text,
  query
}: {
  segments?: HighlightSegment[];
  text: string;
  query: string;
}) {
  // Stem-aware path: render the ts_headline segments the server produced.
  if (segments && segments.length > 0) {
    return (
      <>
        {segments.map((segment, index) =>
          segment.kind === "match" ? (
            <mark
              key={index}
              className="rounded-sm bg-amber-200/80 px-0.5 font-semibold text-slate-950"
            >
              {segment.value}
            </mark>
          ) : (
            <Fragment key={index}>{segment.value}</Fragment>
          )
        )}
      </>
    );
  }
  // Fallback: literal-substring highlight of the raw query, matching the prior
  // behavior for any keyword result that lacks segments.
  return <HighlightedText text={text} match={query} />;
}
```

- [ ] **Step 6: Use it in the keyword render branch**

Replace the keyword-text line (currently line 558):

```tsx
                    <HighlightedText text={result.text} match={query} />
```

with:

```tsx
                    <KeywordHighlight
                      segments={result.highlightSegments}
                      text={result.text}
                      query={query}
                    />
```

- [ ] **Step 7: Run the component test + typecheck**

Run: `npx vitest run tests/unit/components/SearchPanel-highlight.test.tsx` then `npx tsc --noEmit --pretty false`
Expected: PASS (2 tests) / exit 0.

- [ ] **Step 8: Commit**

```bash
git add components/SearchPanel.tsx tests/unit/components/SearchPanel-highlight.test.tsx
git commit -m "Render stem-aware highlight segments in keyword results"
```

### Task 6: Apply migration to the test/eval branch + integration tests

**Files:**
- Modify: `tests/integration/fts-search.test.ts`

- [ ] **Step 1: Apply the migration to the test/eval Neon branch (ep-restless-union via `.env.test`)**

Run: `npm run db:migrate:deploy:test` (the CA-wrapped script added in Task 1 Step 2)
Expected: `20260613120000_english_stem_fts` applied; `All migrations have been successfully applied.` This branch backs both `test:integration` and the local/CI eval gate, so the column must exist here before either runs.

(If the `node_modules/prisma/build/index.js` entry path differs in your Prisma version, adjust the `db:migrate:deploy:test` script to your Prisma CLI entry, or run `prisma migrate deploy` in a shell whose `DATABASE_URL`/`DIRECT_URL` are set to the `.env.test` values.)

- [ ] **Step 2: Confirm the reference fixtures against the seed (do this before writing assertions)**

The assertions below name specific verses. Confirm them against the seeded corpus first — run a throwaway query (e.g. in a Node REPL or a temporary test) of `searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 })` and `searchKeyword({ query: "beloved", corpus: "WEB", pageSize: 100 })`, and pick: (a) a verse whose surface form is `loved`/`loving` (not the bare word `love`) that appears in the `love` results, and (b) a verse containing `beloved` but no love-stem word. The examples used below (`John 3:16` for (a), `3John 1:2` for (b)) are expected to be present; substitute real ones if not. Reference strings use `formatReference`'s OSIS form (`3John 1:2`, not `3 John 1:2`). For the beloved-only exclusion guard, scope both queries to that book so pagination cannot hide the reference. The assertion shapes stay identical.

- [ ] **Step 3: Write the integration cases**

Add to `tests/integration/fts-search.test.ts` inside the `describe.skipIf(!enabled)("FTS keyword search", …)` block:

```typescript
  it("stems English: a 'love' search includes inflections like 'loved'", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 });
    const refs = love.results.map((r) => r.reference);
    expect(love.pagination.total).toBeGreaterThan(0);
    // A verse whose surface form is "loved" (not the bare word "love").
    expect(refs).toContain("John 3:16"); // "God so loved the world"
  });

  it("does not match a different stem: 'love' excludes 'beloved'-only verses", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", book: "3John", pageSize: 100 });
    const beloved = await searchKeyword({ query: "beloved", corpus: "WEB", book: "3John", pageSize: 100 });
    const loveRefs = new Set(love.results.map((r) => r.reference));
    // 3John 1:2 ("Beloved, I pray…") contains "beloved" but no love-stem word.
    expect(beloved.results.some((r) => r.reference === "3John 1:2")).toBe(true);
    expect(loveRefs.has("3John 1:2")).toBe(false);
  });

  it("highlights the stemmed inflection (segments contain a match)", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 });
    const john316 = love.results.find((r) => r.reference === "John 3:16");
    expect(john316?.highlightSegments?.some((s) => s.kind === "match")).toBe(true);
  });

  it("leaves Greek matching unchanged (whole-lexeme λόγος)", async () => {
    const greek = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });
    expect(greek.pagination.total).toBeGreaterThan(0);
    // Still whole-lexeme: a fragment does not match.
    const fragment = await searchKeyword({ query: "λογ", corpus: "SBLGNT" });
    expect(fragment.pagination.total).toBe(0);
  });
```

- [ ] **Step 4: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS, including the four new cases and the pre-existing FTS tests (the `lov`→0 / `love`→>0 substring test still holds — `lov` is not a stem of `love`).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/fts-search.test.ts
git commit -m "Add integration coverage for English stemming and Greek invariance"
```

### Task 7: Eval-gate regression pass + acceptance check

**Files:**
- Possibly modify: `eval/dataset/golden-set.json` (only if a *gated* item legitimately shifts)

> **There is no keyword eval gate.** `eval/dataset/schema.ts` types items as `exact-verse`,
> `lemma-survey`, `conceptual`, `domain`, `cross-chapter` — no `keyword` type — and
> `eval/thresholds.ts` has no keyword gate. The direct proof of stemming is the integration
> suite (Task 6). Here `eval:gate` runs only as a **regression guard**: stemming can perturb a
> gated item whose retrieval plan happens to include a keyword call. Do **not** add a keyword
> query type in this PR (separate eval-expansion task).

- [ ] **Step 1: Run the deterministic eval gate**

Run: `npm run eval:gate`
Expected: `gate passes`. The gated types are exact-verse/cross-chapter (recall+precision = 1.0)
and lemma-survey (recall = 1.0), plus the two global hard gates (citation resolvability,
lemma coverage = 100%). `conceptual` (which now exercises the stemmed semantic FTS leg) is
report-only, so it does not fail the gate.

- [ ] **Step 2: If a GATED item regresses, fix the measurement — not the threshold**

If the gate flags a gated item (most plausibly a precision dip on exact-verse/cross-chapter
from a keyword call in its plan):
- Inspect that item in `eval/dataset/golden-set.json`. If stemming surfaced additional
  **correct** verses, extend the item's expected `goldenReferences`; if it surfaced
  **off-target** verses, tighten the query or rescope the expected set.
- **Do NOT lower thresholds** in `eval/thresholds.ts` to make it pass (project eval
  philosophy). Adjust the golden set / measurement so the metric stays meaningful, and note
  the change in the PR description.
- Re-run `npm run eval:gate` until green.

- [ ] **Step 3: Confirm the acceptance suite is unaffected**

The acceptance test pins a **lemma** count (`40 results for lemma "λόγος" in John`), which stemming does not touch, and asserts no keyword count.

Run: `npm run test:acceptance`
Expected: PASS unchanged. (If a keyword-count assertion was added to `scripts/acceptance-test.js` after this plan was written, size it to the post-stemming total.)

- [ ] **Step 4: Commit any golden-set change (skip if none)**

```bash
git add eval/dataset/golden-set.json
git commit -m "Rescope keyword golden item(s) for stemmed recall"
```

### Task 8: Documentation

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `README.md`, `docs/superpowers/specs/2026-05-30-lexical-fts-design.md`, `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: PROJECT_STATE — close the deferred item + record the migration**

- In the Phase 3 / "Logical next steps" notes that say English Snowball stemming is deferred, change the wording to ✅ done with a one-line summary (English keyword search stems via `bible_english`/`textSearchEn`; Greek unchanged; stem-aware `ts_headline` highlighting).
- Add to the migrations list (after `20260611120000_saved_search_domain_filters`):
  ```markdown
  - `20260613120000_english_stem_fts` — `bible_english` immutable config (unaccent + english_stem); `Verse.textSearchEn` generated tsvector + `Verse_textSearchEn_idx` GIN index. English (WEB) keyword search stems; Greek keeps `bible_simple` (handwritten; applied via `migrate deploy` to the dev/prod and test/eval Neon branches).
  ```
- Update the snapshot line and the `/search` row's keyword description to note English stems / Greek whole-lexeme.

- [ ] **Step 2: README — follow-ups + `/search` description**

- In `## Current Follow-Ups`, remove or rewrite the line that defers English stemming.
- In the `/search` product-surface description, note that keyword mode stems English (WEB) and keeps Greek whole-lexeme, with highlighting that tracks the stemmer.

- [ ] **Step 3: lexical-FTS spec + roadmap notes**

- In `docs/superpowers/specs/2026-05-30-lexical-fts-design.md`, add a one-line note that the deferred English Snowball stemming landed (2026-06-13) via `bible_english`/`textSearchEn`.
- In `docs/HiFi-exegesis-nt-roadmap.md`, update the Phase 3 line similarly.

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_STATE.md README.md docs/superpowers/specs/2026-05-30-lexical-fts-design.md docs/HiFi-exegesis-nt-roadmap.md
git commit -m "Document English keyword stemming as shipped"
```

### Task 9: Verify, push, open PR, stop

- [ ] **Step 1:** Run `npm run verify` — exit 0 (lint + tsc + build + coverage gate).
- [ ] **Step 2:** Run `npm run test:integration` — exit 0 (already green from Task 6; re-confirm).
- [ ] **Step 3:** Push: `git push -u origin feat/english-keyword-stemming`
- [ ] **Step 4:** Open the PR (title: "English Snowball stemming for keyword search"). Body: summarize the migration, the unified language-routed `searchKeyword` predicate, the stemmed `searchSemantic` FTS leg, `ts_headline` highlighting, tests, and any gated golden-set rescope; note the migration is already applied to both Neon branches and that keyword is not a gated eval type (integration tests are the proof).
- [ ] **Step 5:** **Stop. Report to the maintainer and wait for review/merge** (including Codex/CodeRabbit bot comments). The `Eval Gate / gate` check must pass on the PR.

---

## Notes for the implementer

- **Migration is shared infra.** ep-tiny-queen backs both local dev and production; ep-restless-union backs integration tests and the eval gate. Tasks 1 and 6 apply the migration to both, so production gets `textSearchEn` before any code referencing it deploys. Never run `prisma migrate dev` here.
- **Two assistant English keyword paths, both stemmed.** The deterministic planner calls `searchKeyword` (`orderBy: "rank"`) — it consumes `reference`/`text`/`formattedEvidence` and ignores `highlightSegments`, so no planner change is needed (Task 4). The hybrid path calls `searchSemantic`, whose **separate** WEB-only FTS leg is stemmed in Task 4 Steps 8–11. Leaving only one of these stemmed would make keyword vs conceptual prompts retrieve inconsistently.
- **Keyword is not a gated eval type.** `eval:gate` is a regression guard, not proof of stemming; the integration tests (Task 6) are the proof. See Task 7. A dedicated keyword eval type is a separate future task.
- **Greek highlighting improves incidentally:** routing Greek keyword highlight through `ts_headline('bible_simple', …)` fixes the latent accent case where an unaccented query previously highlighted nothing. No separate task — it falls out of Task 4.
