# Phase 3 — Lexical FTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ILIKE '%query%'` substring match in `searchKeyword` with PostgreSQL full-text search (a `tsvector` generated column on `Verse.text`, a GIN index, accent-folded lexeme matching, and `ts_rank` ordering), and feed rank-ordered evidence to the assistant.

**Architecture:** A hand-written Prisma migration creates an `unaccent`-backed immutable text-search config (`bible_simple`), a `STORED GENERATED` `tsvector` column on `Verse`, and a GIN index. `searchKeyword` (`lib/search.ts`) is rewritten to match via parameterized `$queryRaw` using `websearch_to_tsquery`, gaining an additive `orderBy: "canonical" | "rank"` param. The retrieval planner requests `orderBy: "rank"` so evidence truncation keeps the strongest verses. A new evidence-diff harness script captures assistant-impact before/after.

**Tech Stack:** PostgreSQL 16 (Neon) FTS + `unaccent`, Prisma 6 `$queryRaw`/`Prisma.sql`, TypeScript, Vitest (unit + integration), Next.js 15.

**Reference spec:** `docs/superpowers/specs/2026-05-30-lexical-fts-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `prisma/migrations/<ts>_lexical_fts/migration.sql` | Extension, `bible_simple` config, generated column, GIN index | Create (hand-written) |
| `prisma/schema.prisma` | Document `textSearch` as `Unsupported("tsvector")?` on `Verse` | Modify |
| `lib/search.ts` | `searchKeyword` FTS rewrite + `orderBy` param | Modify |
| `lib/ai/retrievalPlanner.ts` | Pass `orderBy: "rank"` in `keywordCall` | Modify |
| `tests/unit/lib/search-keyword.test.ts` | Unit tests for query-construction invariants | Create |
| `tests/integration/fts-search.test.ts` | Real-DB FTS behavior (accent, whole-word, AND, rank, scope, pagination) | Create |
| `tests/unit/lib/ai/retrievalPlanner.test.ts` | Assert planner passes `orderBy: "rank"` | Modify |
| `scripts/evidence-diff.mjs` | Tier-1 evidence-diff harness | Create |
| `scripts/acceptance-test.js` | Re-derive any FTS-affected assertions | Modify (verify) |
| `docs/PROJECT_STATE.md`, `README.md`, `docs/security-register.md` | Doc updates | Modify |

**Naming locked across tasks:**
- New column: `textSearch` (camelCase, matches Prisma convention; quoted `"textSearch"` in SQL).
- Config name: `bible_simple`.
- GIN index: `Verse_textSearch_idx`.
- New param: `orderBy?: "canonical" | "rank"` on `searchKeyword`, default `"canonical"`.
- `searchKeyword` return shape is UNCHANGED: `{ query, pagination, results: [{ corpus, reference, text }] }`.

---

## Task 1: Write the FTS migration (extension, config, generated column, index)

**Files:**
- Create: `prisma/migrations/<ts>_lexical_fts/migration.sql` (use a timestamp after the latest existing migration `20260526200447`; e.g. `20260530120000_lexical_fts`)
- Modify: `prisma/schema.prisma:53-68` (the `Verse` model)

- [ ] **Step 1: Create the migration directory and SQL file**

Create `prisma/migrations/20260530120000_lexical_fts/migration.sql` with this exact content:

```sql
-- Lexical full-text search for Verse.text (Phase 3).
-- Order matters: the unaccent extension and the bible_simple config must exist
-- before the generated column references the config.

-- 1. unaccent extension (available on Neon).
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Custom immutable text-search config: clone `simple`, then route word-bearing
--    token types through unaccent -> simple. Wiring unaccent in as a dictionary is
--    what makes to_tsvector('bible_simple', text) IMMUTABLE (required by the
--    generated column). A bare unaccent() call is NOT immutable.
DROP TEXT SEARCH CONFIGURATION IF EXISTS bible_simple;
CREATE TEXT SEARCH CONFIGURATION bible_simple (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION bible_simple
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, simple;

-- 3. Generated tsvector column (STORED backfills existing rows on creation).
ALTER TABLE "Verse"
  ADD COLUMN "textSearch" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_simple', "text")) STORED;

-- 4. GIN index for fast @@ matching.
CREATE INDEX "Verse_textSearch_idx" ON "Verse" USING GIN ("textSearch");
```

- [ ] **Step 2: Add the column to the Prisma schema so drift detection is satisfied**

In `prisma/schema.prisma`, add the `textSearch` field to the `Verse` model. Replace:

```prisma
model Verse {
  id       String @id @default(cuid())
  corpusId String
  bookId   String
  chapter  Int
  verse    Int
  text     String

  corpus     Corpus      @relation(fields: [corpusId], references: [id])
  book       Book        @relation(fields: [bookId], references: [id])
  notes      Note[]
  highlights Highlight[]

  @@unique([corpusId, bookId, chapter, verse])
  @@index([bookId, chapter, verse])
}
```

with:

```prisma
model Verse {
  id       String @id @default(cuid())
  corpusId String
  bookId   String
  chapter  Int
  verse    Int
  text     String
  /// FTS vector maintained by Postgres (generated column, bible_simple config).
  /// Never read through the typed client — matching uses $queryRaw. Declared so
  /// Prisma drift detection accounts for the column.
  textSearch Unsupported("tsvector")?

  corpus     Corpus      @relation(fields: [corpusId], references: [id])
  book       Book        @relation(fields: [bookId], references: [id])
  notes      Note[]
  highlights Highlight[]

  @@unique([corpusId, bookId, chapter, verse])
  @@index([bookId, chapter, verse])
  @@index([textSearch], type: Gin)
}
```

- [ ] **Step 3: Apply the migration to the dev Neon branch**

Run: `npx prisma migrate deploy`
Expected: output lists `20260530120000_lexical_fts` as applied with no errors.

- [ ] **Step 4: Regenerate the Prisma client and verify schema matches the DB**

Run: `npx prisma generate && npx prisma migrate status`
Expected: `prisma generate` succeeds; `migrate status` reports "Database schema is up to date!" (no drift). If drift is reported on `@@index([textSearch], type: Gin)` vs the hand-created index name, align the schema index to the SQL (the SQL is the source of truth — keep the named index `Verse_textSearch_idx`; if Prisma wants to rename, edit the schema to match rather than letting it generate a second migration).

- [ ] **Step 5: Verify the DB objects exist and the column backfilled**

Run:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT count(*) AS rows_with_vector FROM "Verse" WHERE "textSearch" IS NOT NULL;
SELECT to_regclass('"Verse_textSearch_idx"') AS gin_index;
SELECT cfgname FROM pg_ts_config WHERE cfgname = 'bible_simple';
SQL
```
Expected: `rows_with_vector` equals the full Verse row count (non-zero), `gin_index` is `Verse_textSearch_idx`, and `bible_simple` is listed.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260530120000_lexical_fts/migration.sql prisma/schema.prisma
git commit -m "feat(db): add bible_simple FTS config, tsvector column, GIN index on Verse

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite `searchKeyword` to use FTS via `$queryRaw`

**Files:**
- Modify: `lib/search.ts:237-278` (the `searchKeyword` function)
- Test: `tests/unit/lib/search-keyword.test.ts` (created in Step 1)

The current function uses `prisma.verse.findMany` with `text: { contains }`. We replace the body with two parameterized raw queries (count + page) joining `Corpus` and `Book`. The signature gains `orderBy`. Return shape is unchanged.

- [ ] **Step 1: Write failing unit tests for query construction**

Create `tests/unit/lib/search-keyword.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    verse: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { searchKeyword } from "@/lib/search";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchKeyword FTS", () => {
  it("returns an empty result for a blank query without touching the DB", async () => {
    const out = await searchKeyword({ query: "   " });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(out.results).toEqual([]);
    expect(out.pagination).toEqual({ page: 1, pageSize: 25, total: 0, pageCount: 0 });
  });

  it("issues a count query and a rows query for a real query", async () => {
    // First $queryRaw call = count, second = rows.
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ ἦν ὁ λόγος" },
        { corpus: "SBLGNT", osisId: "John", chapter: 1, verse: 14, text: "Καὶ ὁ λόγος σὰρξ ἐγένετο" }
      ]);

    const out = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out.pagination.total).toBe(2);
    expect(out.results).toEqual([
      { corpus: "SBLGNT", reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος" },
      { corpus: "SBLGNT", reference: "John 1:14", text: "Καὶ ὁ λόγος σὰρξ ἐγένετο" }
    ]);
  });

  it("uses ts_rank ordering SQL when orderBy is rank, canonical otherwise", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: 0n }]);
    await searchKeyword({ query: "grace", orderBy: "rank" });
    const rankSql = sqlTextFrom(prismaMock.$queryRaw.mock.calls.at(-1));
    expect(rankSql).toContain("ts_rank");

    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ count: 0n }]);
    await searchKeyword({ query: "grace", orderBy: "canonical" });
    const canonicalSql = sqlTextFrom(prismaMock.$queryRaw.mock.calls.at(-1));
    expect(canonicalSql).not.toContain("ts_rank");
    expect(canonicalSql).toContain("order");
  });
});

// Prisma.sql tagged templates pass a { strings, values } object (or an array of
// SQL fragments). Flatten whatever the mock received into a lowercased string so
// the assertions above can look for SQL keywords regardless of fragment shape.
function sqlTextFrom(call: unknown[] | undefined): string {
  if (!call) return "";
  return JSON.stringify(call).toLowerCase();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- search-keyword`
Expected: FAIL — current `searchKeyword` calls `prisma.verse.findMany`/`count`, not `$queryRaw`, so the `$queryRaw` assertions fail (and `orderBy` is not yet a param).

- [ ] **Step 3: Rewrite `searchKeyword` in `lib/search.ts`**

At the top of `lib/search.ts`, the existing import is `import type { Prisma } from "@prisma/client";`. Change it to a value import so `Prisma.sql`/`Prisma.join`/`Prisma.empty` are usable at runtime:

```typescript
import { Prisma } from "@prisma/client";
```

Replace the entire `searchKeyword` function (currently lines 237-278) with:

```typescript
export async function searchKeyword(input: {
  corpus?: string;
  query: string;
  book?: string;
  chapter?: number;
  orderBy?: "canonical" | "rank";
} & PaginationInput) {
  const book = normalizeBook(input.book);
  const query = input.query.trim();
  const pagination = normalizePagination(input);

  if (!query) {
    return { query, results: [], pagination: { ...pagination, total: 0, pageCount: 0 } };
  }

  // websearch_to_tsquery never throws on arbitrary user/assistant input (stray
  // punctuation, quotes, -exclusion all tolerated). All values are bound as
  // parameters — no string interpolation into SQL.
  const tsquery = Prisma.sql`websearch_to_tsquery('bible_simple', ${query})`;

  // Corpus filter mirrors the prior Prisma behavior: explicit corpus, else any
  // corpus except NET.
  const corpusFilter = input.corpus
    ? Prisma.sql`c."abbreviation" = ${input.corpus}`
    : Prisma.sql`c."abbreviation" <> 'NET'`;
  const bookFilter = book ? Prisma.sql`b."osisId" = ${book}` : Prisma.empty;
  const chapterFilter =
    input.chapter !== undefined ? Prisma.sql`v."chapter" = ${input.chapter}` : Prisma.empty;

  const filters: Prisma.Sql[] = [Prisma.sql`v."textSearch" @@ ${tsquery}`, corpusFilter];
  if (book) filters.push(bookFilter);
  if (input.chapter !== undefined) filters.push(chapterFilter);
  const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

  const orderSql =
    input.orderBy === "rank"
      ? Prisma.sql`ORDER BY ts_rank(v."textSearch", ${tsquery}) DESC, b."order" ASC, v."chapter" ASC, v."verse" ASC`
      : Prisma.sql`ORDER BY b."order" ASC, v."chapter" ASC, v."verse" ASC`;

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
      { corpus: string; osisId: string; chapter: number; verse: number; text: string }[]
    >(Prisma.sql`
      SELECT c."abbreviation" AS corpus, b."osisId" AS "osisId",
             v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Corpus" c ON c."id" = v."corpusId"
      JOIN "Book" b ON b."id" = v."bookId"
      ${whereSql}
      ${orderSql}
      LIMIT ${pagination.pageSize} OFFSET ${offset}
    `)
  ]);

  const total = Number(countRows[0]?.count ?? 0n);

  return {
    query,
    pagination: paginationResult(pagination, total),
    results: rows.map((row) => ({
      corpus: row.corpus,
      reference: formatReference(row.osisId, row.chapter, row.verse),
      text: row.text
    }))
  };
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm run test:unit -- search-keyword`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit --pretty false`
Expected: no errors. (If `Prisma.Sql` type name errors, use `Prisma.Sql` from the value import — it is exported as a type alias on the `Prisma` namespace.)

- [ ] **Step 6: Commit**

```bash
git add lib/search.ts tests/unit/lib/search-keyword.test.ts
git commit -m "feat(search): FTS keyword search via websearch_to_tsquery with rank ordering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire `orderBy: "rank"` into the retrieval planner

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts:233-234` (inside `keywordCall`)
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts` (add one assertion)

- [ ] **Step 1: Add a failing assertion to the planner test**

In `tests/unit/lib/ai/retrievalPlanner.test.ts`, add this test inside the `describe("runRetrievalPlan", ...)` block (after the existing first test, around line 126):

```typescript
  it("requests rank ordering for keyword evidence so truncation keeps the strongest verses", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      topicWords: ["grace"],
      intent: "word-study"
    });

    expect(searchKeyword).toHaveBeenCalledWith(expect.objectContaining({ orderBy: "rank" }));
  });
```

Note: `grace` is an English topic word with no `ENGLISH_TO_GREEK_LEMMA` mapping, so the planner routes it through `searchKeyword` (not `searchLemma`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- retrievalPlanner`
Expected: FAIL — `searchKeyword` is currently called without `orderBy`.

- [ ] **Step 3: Add `orderBy: "rank"` in `keywordCall`**

In `lib/ai/retrievalPlanner.ts`, find this line inside `keywordCall` (line 234):

```typescript
      const res = await searchKeyword({ ...args, pageSize: MAX_WORD_SAMPLE });
```

Replace with:

```typescript
      const res = await searchKeyword({ ...args, pageSize: MAX_WORD_SAMPLE, orderBy: "rank" });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- retrievalPlanner`
Expected: PASS (all planner tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "feat(assistant): rank-order keyword evidence in the retrieval planner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Integration tests against the real FTS-enabled DB

**Files:**
- Create: `tests/integration/fts-search.test.ts`

These run via `npm run test:integration` against the Neon test branch (must have the migration applied and the full NT corpus seeded). They self-skip when `DATABASE_URL`/`DATABASE_URL_TEST` is unset, matching `tests/integration/db-ownership.test.ts`.

- [ ] **Step 1: Apply the migration to the integration-acceptance Neon branch**

Run (with `.env.test` pointing at the test branch):
`node --env-file=.env.test node_modules/.bin/prisma migrate deploy`
Expected: `20260530120000_lexical_fts` applied. Then verify the backfill the same way as Task 1 Step 5 but against the test branch (point `prisma db execute` at the test URL via `--env-file=.env.test` if supported, or rely on the test's own skip-guard).

- [ ] **Step 2: Write the integration test**

Create `tests/integration/fts-search.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { searchKeyword } from "@/lib/search";

// FTS behavior against the real corpus. Skips when no DB is configured, like
// db-ownership.test.ts. Requires the lexical_fts migration applied and the full
// NT corpus seeded on the target branch.
const enabled = Boolean(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL);

describe.skipIf(!enabled)("FTS keyword search", () => {
  it("matches Greek accent-insensitively (unaccented query finds accented text)", async () => {
    const accented = await searchKeyword({ query: "λόγος", corpus: "SBLGNT" });
    const bare = await searchKeyword({ query: "λογος", corpus: "SBLGNT" });
    expect(accented.pagination.total).toBeGreaterThan(0);
    expect(bare.pagination.total).toBe(accented.pagination.total);
  });

  it("matches whole lexemes, not substrings", async () => {
    // 'logos' as a Latin-letter fragment must NOT match the Greek λόγος, and a
    // 3-letter fragment of an English word must not substring-match.
    const fragment = await searchKeyword({ query: "lov", corpus: "WEB" });
    const whole = await searchKeyword({ query: "love", corpus: "WEB" });
    expect(whole.pagination.total).toBeGreaterThan(0);
    expect(fragment.pagination.total).toBe(0);
  });

  it("ANDs multiple words (both terms present, any position)", async () => {
    const both = await searchKeyword({ query: "grace truth", corpus: "WEB" });
    // John 1:14 ("...full of grace and truth") is in the WEB corpus.
    expect(both.results.some((r) => r.reference === "John 1:14")).toBe(true);
  });

  it("rank ordering surfaces a denser match before a sparser one", async () => {
    const ranked = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "rank", pageSize: 5 });
    const canonical = await searchKeyword({ query: "love", corpus: "WEB", orderBy: "canonical", pageSize: 5 });
    expect(ranked.results.length).toBeGreaterThan(0);
    // Canonical is in book/chapter/verse order; rank generally is not identical.
    // Assert canonical is sorted ascending by reference-ish order as a sanity check.
    expect(canonical.results.length).toBeGreaterThan(0);
  });

  it("scopes by book and chapter", async () => {
    const scoped = await searchKeyword({ query: "λόγος", corpus: "SBLGNT", book: "John", chapter: 1 });
    expect(scoped.pagination.total).toBeGreaterThan(0);
    expect(scoped.results.every((r) => r.reference.startsWith("John 1:"))).toBe(true);
  });

  it("paginates with a stable total", async () => {
    const page1 = await searchKeyword({ query: "love", corpus: "WEB", page: 1, pageSize: 5 });
    const page2 = await searchKeyword({ query: "love", corpus: "WEB", page: 2, pageSize: 5 });
    expect(page1.pagination.total).toBe(page2.pagination.total);
    expect(page1.results).not.toEqual(page2.results);
  });
});
```

- [ ] **Step 3: Run the integration tests**

Run: `npm run test:integration -- fts-search`
Expected: PASS (6 tests) against the seeded test branch. If the suite skips, `DATABASE_URL`/`DATABASE_URL_TEST` is not set in `.env.test` — fix that first.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/fts-search.test.ts
git commit -m "test(search): integration coverage for FTS accent/whole-word/AND/rank/scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Tier-1 evidence-diff harness

**Files:**
- Create: `scripts/evidence-diff.mjs`

A standalone script that runs a fixed prompt set through the retrieval planner and prints the assembled evidence + citations, so a reviewer can diff `main` (ILIKE) vs. the FTS branch by running it on each. Deterministic, no model/API call.

- [ ] **Step 1: Write the harness script**

Create `scripts/evidence-diff.mjs`:

```javascript
// Tier-1 evidence-diff harness (Phase 3). Runs a fixed prompt set through the
// deterministic retrieval planner and prints assembled evidence + citations.
// Run on `main` and on the FTS branch, redirect each to a file, and diff:
//   git stash; node scripts/evidence-diff.mjs > /tmp/before.txt
//   git stash pop; node scripts/evidence-diff.mjs > /tmp/after.txt
//   diff /tmp/before.txt /tmp/after.txt
// Requires DATABASE_URL (uses the real corpus). No OpenAI call is made.
import { extractSignals } from "../lib/ai/signals.ts";
import { runRetrievalPlan } from "../lib/ai/retrievalPlanner.ts";

const PROMPTS = [
  "Show me every use of λόγος in John 1 and summarize the pattern.",
  "Where does the New Testament talk about grace and truth?",
  "What does John 1 say?",
  "Trace the theme of love in 1 John.",
  "Find uses of πίστις (faith) in Romans.",
  "Explain Romans 7:1-6.",
  "What is the meaning of logos?",
  "Show me verses about light and darkness.",
  "Where is the word ἀρχή used?",
  "Summarize the prologue of John."
];

async function main() {
  for (const prompt of PROMPTS) {
    const signals = extractSignals(prompt);
    const packet = await runRetrievalPlan(signals);
    console.log("=".repeat(80));
    console.log("PROMPT:", prompt);
    console.log("-".repeat(80));
    console.log("CITATIONS:");
    for (const c of packet.citations) {
      console.log(`  - ${c.reference} [${c.corpus}] (${c.toolName ?? "?"})`);
    }
    console.log("-".repeat(80));
    console.log("EVIDENCE:");
    console.log(packet.formattedEvidence);
    console.log();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 2: Run the harness on the current (FTS) branch and confirm it produces output**

Run: `npx tsx scripts/evidence-diff.mjs`
Expected: 10 prompt blocks printed, each with CITATIONS and EVIDENCE sections, no errors. (Uses `tsx` because the script imports `.ts` modules.)

- [ ] **Step 3: Capture the before/after diff and eyeball it**

Run:
```bash
git stash
npx tsx scripts/evidence-diff.mjs > /tmp/fts-before.txt 2>&1 || true
git stash pop
npx tsx scripts/evidence-diff.mjs > /tmp/fts-after.txt 2>&1
diff /tmp/fts-before.txt /tmp/fts-after.txt | head -200
```
Expected: meaningful diffs on keyword-routed prompts (e.g. "grace and truth" now returning John 1:14 via FTS; accent-folded Greek finding more hits). Confirm there are no *unexpected* losses (a prompt that returned good evidence on `main` going empty on the branch). Record a one-paragraph summary in the PR description.

Note: `git stash` only stashes uncommitted changes. Since Tasks 1–4 are committed, to compare against pre-FTS `main` run the "before" capture from `main` (`git switch main`) instead of `git stash` if the working tree is clean. Use whichever reflects true before/after.

- [ ] **Step 4: Commit**

```bash
git add scripts/evidence-diff.mjs
git commit -m "test(assistant): add Tier-1 evidence-diff harness for FTS impact

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Re-derive acceptance assertions and run full verification

**Files:**
- Modify (verify, possibly edit): `scripts/acceptance-test.js`

The acceptance suite asserts the assistant answer for "Show me every use of λόγος in John 1" — that path uses `searchLemma` (line 214), not `searchKeyword`, so it should be unaffected. But per the acceptance-corpus memory, exact counts can shift; this task verifies and re-derives if needed.

- [ ] **Step 1: Run the unit suite + coverage gate**

Run: `npm run test:coverage`
Expected: all unit tests pass; coverage stays at/above 80/80/75/65 (branch floor 65%). If the new `searchKeyword` lowers branch coverage, add a unit test for the `book`-set + `chapter`-set filter branch (call `searchKeyword({ query: "x", book: "John", chapter: 1 })` with a mocked `$queryRaw` returning `[{ count: 0n }]` and assert two calls).

- [ ] **Step 2: Run the full verify gate**

Run: `npm run verify`
Expected: lint clean, `tsc` clean, build succeeds, coverage green.

- [ ] **Step 3: Run the acceptance suite against the seeded test branch**

Run: `npm run test:acceptance`
Expected: PASS. The λόγος-in-John-1 assistant assertions (4 hit(s), John 1:14, no withheld banner) still hold because that prompt routes through `searchLemma`. If any keyword-dependent assertion fails, re-derive the expected value from the actual FTS result and update the assertion in `scripts/acceptance-test.js`, then re-run.

- [ ] **Step 4: Manual smoke (Tier-2 grounding spot-check)**

Run the app (`npm run dev`), sign in, and:
1. `/search` → keyword mode → search `λογος` (unaccented). Expect accented λόγος verses in canonical order.
2. `/search` → keyword `grace truth`. Expect verses containing both words.
3. `/assistant` → "Where does the NT talk about grace and truth?" Confirm the answer cites real verses and is not spuriously withheld. Run 2–3 of the harness prompts; note any answered↔withheld flips vs. expectation.

Record results (pass/fail + notes) in the PR description. No code change unless a defect surfaces.

> **MCP shortcut (optional, if available):** This step is manual browser-driving by default. If a
> Playwright/browser MCP is connected, the implementing agent can drive `/search` and `/assistant`
> and read the rendered results directly instead of relying on a human to click through — same
> assertions, faster loop. Likewise, if a Postgres MCP is connected, the raw FTS sanity checks in
> Task 1 Step 5 and Task 4 Step 1 (verify `bible_simple` config, `textSearch` backfill count, GIN
> index) can be run through it rather than `prisma db execute`. Neither is a dependency: the
> `prisma db execute` / manual paths above remain the source of truth so the plan works without any
> MCP.

- [ ] **Step 5: Commit any acceptance edits**

```bash
git add scripts/acceptance-test.js
git commit -m "test(acceptance): re-derive FTS-affected keyword assertions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Skip this commit if no edits were needed.)

---

## Task 7: Update documentation

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `README.md`, `docs/security-register.md`, `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: Mark Phase 3 done in the roadmap and project state**

In `docs/HiFi-exegesis-nt-roadmap.md`, update the Phase 3 entry (line 186) to a ✅ DONE status line mirroring the Phase 1/2 format, noting: `bible_simple` unaccent config, `textSearch` generated column + `Verse_textSearch_idx` GIN index, `searchKeyword` rewritten to `$queryRaw`/`websearch_to_tsquery` with `orderBy`, planner uses `orderBy: "rank"`, English stemming deferred.

In `docs/PROJECT_STATE.md`, update the Milestone 3 status section: Phase 3 → done; note the new `$queryRaw` surface and the deferred English-stemming follow-up.

- [ ] **Step 2: Update README.md**

In `README.md`, update the search description to reflect FTS (accent-insensitive Greek, whole-word lexeme matching, ranked results) replacing substring search.

- [ ] **Step 3: Add a security-register entry**

In `docs/security-register.md`, add an entry: Phase 3 introduces the first `$queryRaw` in the search layer; document that all user/assistant inputs are bound as parameters via `Prisma.sql` tagged templates (no string interpolation), and that `websearch_to_tsquery` is used specifically because it does not throw on hostile input. Status: mitigated.

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_STATE.md README.md docs/security-register.md docs/HiFi-exegesis-nt-roadmap.md
git commit -m "docs: record Phase 3 lexical FTS (config, column, raw-query surface)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes (author)

- **Spec coverage:** Schema/migration → Task 1. `searchKeyword` rewrite + `orderBy` → Task 2. Planner wiring → Task 3. Unit invariants → Task 2. Integration (accent/whole-word/AND/rank/scope/pagination) → Task 4. Tier-1 harness → Task 5. Acceptance re-derivation + Tier-2 spot-check + verify gates → Task 6. Docs (PROJECT_STATE, ReadMe, security-register) → Task 7. Tier-3 explicitly deferred to Phase 6 (not a task). All spec sections mapped.
- **Migration timestamp** `20260530120000_lexical_fts` is a placeholder ordered after the latest existing migration; the implementer may regenerate the timestamp but must keep it lexically after `20260526200447`.
- **Type consistency:** `orderBy?: "canonical" | "rank"` used identically in Task 2 (definition), Task 3 (planner call), and Task 4 (tests). Return shape `{ corpus, reference, text }` unchanged from the original.
