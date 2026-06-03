# Vector + Hybrid Retrieval (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic (vector) retrieval to the NT assistant: embed WEB verses with OpenAI, fuse vector + FTS results with Reciprocal Rank Fusion, expand hits to ±2 on-spine context, and fire it only on topical/conceptual prompts — citations always resolving to the SBLGNT spine.

**Architecture:** A dedicated `VerseEmbedding` table (pgvector, `vector(1536)`, HNSW/cosine) holds one embedding per WEB verse. `lib/search.ts` gains `embedQuery` + `searchSemantic` (vector KNN + keyword FTS, RRF-fused via a pure `lib/search/rrf.ts`, then filtered to references that exist in SBLGNT). `lib/ai/retrievalPlanner.ts` gains a gated `semanticCall` that expands each hit to an on-spine ±2 window. A `scripts/embed-verses.ts` ingestion script populates the table. Everything degrades gracefully without `OPENAI_API_KEY`.

**Tech Stack:** Next 15 / TypeScript 5.8, Prisma 6 over PostgreSQL on Neon (pgvector), OpenAI `text-embedding-3-small`, Vitest 4. Spec: `docs/superpowers/specs/2026-06-02-vector-hybrid-retrieval-design.md`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `lib/search/rrf.ts` | Pure Reciprocal Rank Fusion over ranked reference lists | Create |
| `prisma/schema.prisma` | `VerseEmbedding` model + relation on `Verse` | Modify |
| `prisma/migrations/20260602120000_add_verse_embeddings/migration.sql` | pgvector extension + table + HNSW index | Create |
| `lib/search.ts` | `SEMANTIC_INDEX_CORPUS`, `EMBEDDING_MODEL`, `formatVectorLiteral`, `spineKey`, `filterToSblSpine`, `embedQuery`, `searchSemantic` | Modify |
| `scripts/embed-verses.ts` | Idempotent embedding ingestion over WEB verses | Create |
| `package.json` | `embed:verses` script | Modify |
| `lib/ai/retrievalPlanner.ts` | `shouldRunSemantic` gate, `semanticCall`, on-spine ±2 window, thread `prompt` | Modify |
| `lib/ai/assistant.ts` | Pass `prompt` into `runRetrievalPlan` | Modify |
| `tests/unit/lib/search/rrf.test.ts` | RRF unit tests | Create |
| `tests/unit/lib/search-semantic.test.ts` | `searchSemantic` + helpers unit tests (mocked) | Create |
| `tests/unit/lib/ai/retrievalPlanner.test.ts` | Gate + `semanticCall` tests; extend `@/lib/search` mock | Modify |
| `tests/integration/semantic-search.test.ts` | Real KNN against the Neon test branch | Create |
| `scripts/acceptance-test.js` | One topical-query interaction | Modify |
| `docs/HiFi-exegesis-nt-roadmap.md`, `docs/Project_State.md`, `ReadMe.md`, `docs/security-register.md` | Docs | Modify |

**Note on environment:** unit tests (mocked) run anywhere. The migration, ingestion script, integration test, and acceptance test require `DATABASE_URL`/`DIRECT_URL` pointed at a Neon branch with the migration applied and embeddings ingested, and `OPENAI_API_KEY` set. Use `$env:NODE_OPTIONS="--use-system-ca"` on the maintainer's Windows machine (see `docs/security-register.md`).

---

## Task 1: Reciprocal Rank Fusion (pure function)

**Files:**
- Create: `lib/search/rrf.ts`
- Test: `tests/unit/lib/search/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/search/rrf.test.ts
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";

const ref = (reference: string): RankedRef => ({ reference, corpus: "WEB", text: reference });

describe("reciprocalRankFusion", () => {
  it("returns [] for no lists and for empty lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("ranks a reference appearing in both lists above singletons", () => {
    const a = [ref("John 1:1"), ref("John 1:2")];
    const b = [ref("John 3:16"), ref("John 1:1")];
    const fused = reciprocalRankFusion([a, b]);
    expect(fused[0].reference).toBe("John 1:1"); // in both lists → highest fused score
  });

  it("dedupes by reference and keeps first-seen metadata", () => {
    const a = [{ reference: "John 1:1", corpus: "WEB", text: "first" }];
    const b = [{ reference: "John 1:1", corpus: "WEB", text: "second" }];
    const fused = reciprocalRankFusion([a, b]);
    expect(fused).toHaveLength(1);
    expect(fused[0].text).toBe("first");
  });

  it("preserves single-list order", () => {
    const a = [ref("A 1:1"), ref("A 1:2"), ref("A 1:3")];
    expect(reciprocalRankFusion([a]).map((r) => r.reference)).toEqual(["A 1:1", "A 1:2", "A 1:3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/lib/search/rrf.test.ts`
Expected: FAIL — cannot resolve `@/lib/search/rrf`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/search/rrf.ts
export type RankedRef = { reference: string; corpus: string; text: string };

// Reciprocal Rank Fusion. Each input list is in descending relevance order.
// Fused score for a reference = Σ over lists of 1/(k + rank0), rank0 0-based.
// Deduped by reference; the first-seen item supplies the kept corpus/text.
export function reciprocalRankFusion(lists: RankedRef[][], k = 60): RankedRef[] {
  const scores = new Map<string, number>();
  const meta = new Map<string, RankedRef>();
  for (const list of lists) {
    list.forEach((item, rank0) => {
      scores.set(item.reference, (scores.get(item.reference) ?? 0) + 1 / (k + rank0));
      if (!meta.has(item.reference)) meta.set(item.reference, item);
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reference]) => meta.get(reference)!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/lib/search/rrf.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/search/rrf.ts tests/unit/lib/search/rrf.test.ts
git commit -m "feat(search): add pure Reciprocal Rank Fusion helper"
```

---

## Task 2: VerseEmbedding schema + pgvector migration

**Files:**
- Modify: `prisma/schema.prisma` (add model + relation field on `Verse`)
- Create: `prisma/migrations/20260602120000_add_verse_embeddings/migration.sql`

- [ ] **Step 1: Add the `VerseEmbedding` model to `prisma/schema.prisma`**

Add a relation field to the existing `Verse` model (inside the relations block, alongside `notes`/`highlights`):

```prisma
  embedding  VerseEmbedding?
```

Add the new model after the `Verse` model:

```prisma
model VerseEmbedding {
  verseId   String   @id
  /// pgvector column. Never read through the typed client — KNN uses $queryRaw.
  /// Declared so Prisma drift detection accounts for the column.
  embedding Unsupported("vector(1536)")
  model     String
  createdAt DateTime @default(now())

  verse Verse @relation(fields: [verseId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260602120000_add_verse_embeddings/migration.sql`:

```sql
-- Vector embeddings for semantic retrieval (Phase 4a).
-- Only WEB verses are embedded; the semantic index corpus. Citations still
-- resolve to the SBLGNT spine via the shared (book, chapter, verse).

-- 1. pgvector extension (available on Neon).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. One embedding per verse (1:1 with Verse), cascade on verse delete.
CREATE TABLE "VerseEmbedding" (
  "verseId"   TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "model"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerseEmbedding_pkey" PRIMARY KEY ("verseId")
);

ALTER TABLE "VerseEmbedding"
  ADD CONSTRAINT "VerseEmbedding_verseId_fkey"
  FOREIGN KEY ("verseId") REFERENCES "Verse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. HNSW index for fast cosine KNN (1536 dims is within pgvector's index limit).
CREATE INDEX "VerseEmbedding_embedding_idx"
  ON "VerseEmbedding" USING hnsw ("embedding" vector_cosine_ops);
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no schema errors. (Validates the `Unsupported` column + relation parse.)

- [ ] **Step 4: Apply the migration to the Neon branch(es)**

Requires `DATABASE_URL`/`DIRECT_URL` pointed at Neon.
Run: `npx prisma migrate deploy`
Expected: applies `20260602120000_add_verse_embeddings`. Re-run against the `integration-acceptance` test branch's connection string as well (the suite in Tasks 7–8 needs the table).

> If `prisma migrate deploy` reports drift on the `Unsupported` column, this matches the existing `lexical_fts` precedent — the hand-written SQL is the source of truth; do not let `migrate dev` rewrite it.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260602120000_add_verse_embeddings/migration.sql
git commit -m "feat(db): add VerseEmbedding table + pgvector HNSW index"
```

---

## Task 3: Shared search helpers (constants, vector literal, SBL-spine filter)

**Files:**
- Modify: `lib/search.ts`
- Test: `tests/unit/lib/search-semantic.test.ts` (created here, extended in Task 4)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/search-semantic.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    verse: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { formatVectorLiteral, spineKey, filterToSblSpine } from "@/lib/search";

beforeEach(() => vi.clearAllMocks());

describe("formatVectorLiteral", () => {
  it("renders a number[] as a pgvector literal", () => {
    expect(formatVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
  });
});

describe("spineKey", () => {
  it("joins book|chapter|verse", () => {
    expect(spineKey("John", 1, 1)).toBe("John|1|1");
  });
});

describe("filterToSblSpine", () => {
  it("returns an empty set without touching the DB for empty input", async () => {
    const set = await filterToSblSpine([]);
    expect(set.size).toBe(0);
    expect(prismaMock.verse.findMany).not.toHaveBeenCalled();
  });

  it("returns the set of references that exist in SBLGNT", async () => {
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 1, verse: 1, book: { osisId: "John" } }
    ]);
    const set = await filterToSblSpine([
      { book: "John", chapter: 1, verse: 1 },
      { book: "John", chapter: 1, verse: 2 }
    ]);
    expect(set.has("John|1|1")).toBe(true);
    expect(set.has("John|1|2")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/lib/search-semantic.test.ts`
Expected: FAIL — `formatVectorLiteral` / `spineKey` / `filterToSblSpine` not exported.

- [ ] **Step 3: Add the helpers to `lib/search.ts`**

At the top of `lib/search.ts`, the `Prisma` import already exists. Add these exports (place near the top, after the existing type declarations):

```ts
// The single corpus whose verses are embedded for semantic search. Other English
// translations added later are display-only, resolved by reference (see spec).
export const SEMANTIC_INDEX_CORPUS = "WEB" as const;
export const EMBEDDING_MODEL = "text-embedding-3-small";

// Render a JS number[] as a pgvector text literal: "[0.1,0.2,...]".
export function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function spineKey(book: string, chapter: number, verse: number): string {
  return `${book}|${chapter}|${verse}`;
}

// Given candidate references, return the set of spineKeys that EXIST in SBLGNT.
// Used to drop WEB-only verses (e.g. Acts 8:37) before they reach synthesis, so a
// cited reference can never be unresolvable on the citation spine.
export async function filterToSblSpine(
  refs: { book: string; chapter: number; verse: number }[]
): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await prisma.verse.findMany({
    where: {
      corpus: { abbreviation: "SBLGNT" },
      OR: refs.map((r) => ({ book: { osisId: r.book }, chapter: r.chapter, verse: r.verse }))
    },
    select: { chapter: true, verse: true, book: { select: { osisId: true } } }
  });
  return new Set(rows.map((r) => spineKey(r.book.osisId, r.chapter, r.verse)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/lib/search-semantic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/search.ts tests/unit/lib/search-semantic.test.ts
git commit -m "feat(search): add semantic-search helpers (vector literal, SBL-spine filter)"
```

---

## Task 4: `embedQuery` + `searchSemantic`

**Files:**
- Modify: `lib/search.ts`
- Test: `tests/unit/lib/search-semantic.test.ts` (extend)

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Add the OpenAI client mock at the TOP of `tests/unit/lib/search-semantic.test.ts` (alongside the existing `vi.mock("@/lib/db", ...)`):

```ts
const { getOpenAiMock } = vi.hoisted(() => ({ getOpenAiMock: vi.fn() }));
vi.mock("@/lib/ai/openaiClient", () => ({ getOpenAi: getOpenAiMock }));
```

Then append these tests:

```ts
import { searchSemantic } from "@/lib/search";

const fakeClient = (embedding: number[]) => ({
  embeddings: { create: vi.fn().mockResolvedValue({ data: [{ embedding }] }) }
});

describe("searchSemantic", () => {
  it("returns [] and skips all DB work when there is no OpenAI client", async () => {
    getOpenAiMock.mockReturnValue(null);
    const out = await searchSemantic({ query: "reconciliation" });
    expect(out).toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("runs vector KNN, drops WEB-only refs, and returns on-spine results", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    // vector KNN rows (one is WEB-only): keywords empty → FTS half skipped.
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { osisId: "Eph", chapter: 2, verse: 16, text: "and might reconcile both" },
      { osisId: "Acts", chapter: 8, verse: 37, text: "WEB-only verse" }
    ]);
    // SBL-spine filter: only Eph 2:16 exists in SBLGNT.
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemantic({ query: "what does Paul say about reconciliation" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1); // vector only; no keywords → no FTS
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16"]);
    expect(out[0].corpus).toBe("WEB");
  });

  it("also runs the FTS half when keywords are supplied", async () => {
    getOpenAiMock.mockReturnValue(fakeClient([0.1, 0.2, 0.3]));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]) // vector
      .mockResolvedValueOnce([{ osisId: "Eph", chapter: 2, verse: 16, text: "reconcile" }]); // FTS
    prismaMock.verse.findMany.mockResolvedValueOnce([
      { chapter: 2, verse: 16, book: { osisId: "Eph" } }
    ]);

    const out = await searchSemantic({ query: "reconciliation", keywords: "reconciliation" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2); // vector + FTS
    expect(out.map((r) => r.reference)).toEqual(["Eph 2:16"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/lib/search-semantic.test.ts`
Expected: FAIL — `searchSemantic` / `embedQuery` not exported.

- [ ] **Step 3: Implement `embedQuery` + `searchSemantic` in `lib/search.ts`**

Add the import near the other imports at the top:

```ts
import { getOpenAi } from "@/lib/ai/openaiClient";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";
```

Add the functions (after the helpers from Task 3):

```ts
export async function embedQuery(text: string): Promise<number[] | null> {
  const client = getOpenAi();
  const input = text.trim();
  if (!client || !input) return null;
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input });
  return res.data[0]?.embedding ?? null;
}

type SemanticRow = { osisId: string; chapter: number; verse: number; text: string };

// Hybrid semantic search: vector KNN over the embedded WEB index fused with a
// keyword FTS pass, then filtered to the SBLGNT spine. `query` is embedded (full
// natural-language prompt); `keywords` drives the FTS half (distilled topic words —
// bible_simple keeps stopwords, so the full prompt would AND to nothing). Returns
// [] when no OpenAI client (embedQuery null).
export async function searchSemantic(input: {
  query: string;
  keywords?: string;
  book?: string;
  limit?: number;
}): Promise<RankedRef[]> {
  const query = input.query.trim();
  if (!query) return [];
  const vector = await embedQuery(query);
  if (!vector) return [];

  const book = normalizeBook(input.book);
  const limit = Math.max(1, Math.min(input.limit ?? 5, 25));
  const POOL = 30;
  const vec = formatVectorLiteral(vector);
  const bookFilter = book ? Prisma.sql`AND b."osisId" = ${book}` : Prisma.empty;

  const vectorRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
    SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
    FROM "VerseEmbedding" e
    JOIN "Verse" v ON v."id" = e."verseId"
    JOIN "Book" b ON b."id" = v."bookId"
    JOIN "Corpus" c ON c."id" = v."corpusId"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} ${bookFilter}
    ORDER BY e."embedding" <=> ${vec}::vector
    LIMIT ${POOL}
  `);

  const keywords = input.keywords?.trim() ?? "";
  let ftsRows: SemanticRow[] = [];
  if (keywords) {
    const tsquery = Prisma.sql`websearch_to_tsquery('bible_simple', ${keywords})`;
    ftsRows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
      SELECT b."osisId" AS "osisId", v."chapter" AS chapter, v."verse" AS verse, v."text" AS text
      FROM "Verse" v
      JOIN "Book" b ON b."id" = v."bookId"
      JOIN "Corpus" c ON c."id" = v."corpusId"
      WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} ${bookFilter}
        AND v."textSearch" @@ ${tsquery}
      ORDER BY ts_rank(v."textSearch", ${tsquery}) DESC
      LIMIT ${POOL}
    `);
  }

  const toRanked = (rows: SemanticRow[]): RankedRef[] =>
    rows.map((r) => ({
      reference: formatReference(r.osisId, r.chapter, r.verse),
      corpus: SEMANTIC_INDEX_CORPUS,
      text: r.text
    }));

  const fused = reciprocalRankFusion([toRanked(vectorRows), toRanked(ftsRows)]);

  // SBL-spine filter: keep only fused refs that exist in SBLGNT.
  const allRows = [...vectorRows, ...ftsRows];
  const spine = await filterToSblSpine(
    allRows.map((r) => ({ book: r.osisId, chapter: r.chapter, verse: r.verse }))
  );
  const byRef = new Map(allRows.map((r) => [formatReference(r.osisId, r.chapter, r.verse), r]));
  const onSpine = fused.filter((f) => {
    const r = byRef.get(f.reference);
    return r ? spine.has(spineKey(r.osisId, r.chapter, r.verse)) : false;
  });

  return onSpine.slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/lib/search-semantic.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit --pretty false`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/search.ts tests/unit/lib/search-semantic.test.ts
git commit -m "feat(search): add embedQuery + searchSemantic (vector+FTS RRF, SBL-spine filtered)"
```

---

## Task 5: Embedding ingestion script

**Files:**
- Create: `scripts/embed-verses.ts`
- Modify: `package.json` (add `embed:verses`)

> Scripts are outside the coverage scope (`app/api/**` + `lib/**`), so no unit test is required. The shared `formatVectorLiteral` is already tested in Task 3 and reused here.

- [ ] **Step 1: Write the script**

Create `scripts/embed-verses.ts`:

```ts
import { PrismaClient, Prisma } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();
const MODEL = "text-embedding-3-small";
const SEMANTIC_INDEX_CORPUS = "WEB";
const BATCH = 100;

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required to embed verses.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey });

  // Idempotent/resumable: only verses in the index corpus with no embedding row.
  const pending = await prisma.$queryRaw<{ id: string; text: string }[]>(Prisma.sql`
    SELECT v."id" AS id, v."text" AS text
    FROM "Verse" v
    JOIN "Corpus" c ON c."id" = v."corpusId"
    LEFT JOIN "VerseEmbedding" e ON e."verseId" = v."id"
    WHERE c."abbreviation" = ${SEMANTIC_INDEX_CORPUS} AND e."verseId" IS NULL
    ORDER BY v."id"
  `);

  console.log(`Embedding ${pending.length} ${SEMANTIC_INDEX_CORPUS} verses with ${MODEL}…`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: MODEL, input: batch.map((b) => b.text) });
    for (let j = 0; j < batch.length; j++) {
      const vec = vectorLiteral(res.data[j].embedding);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "VerseEmbedding" ("verseId", "embedding", "model", "createdAt")
        VALUES (${batch[j].id}, ${vec}::vector, ${MODEL}, now())
        ON CONFLICT ("verseId") DO UPDATE
          SET "embedding" = EXCLUDED."embedding", "model" = EXCLUDED."model", "createdAt" = now()
      `);
    }
    console.log(`  ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
  }

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after the `import:macula-glosses` line, add:

```json
    "embed:verses": "tsx scripts/embed-verses.ts"
```

- [ ] **Step 3: Run the ingestion against Neon**

Requires `DATABASE_URL` (Neon) + `OPENAI_API_KEY` set, migration from Task 2 applied.
Run: `npm run embed:verses`
Expected: logs `Embedding <N> WEB verses…`, progress lines, `Done.` Re-running prints `Embedding 0 WEB verses…` (idempotent). Also run against the `integration-acceptance` branch so Tasks 7–8 have data.

- [ ] **Step 4: Sanity-check the row count**

Run: `npx prisma db execute --stdin` then type: `SELECT count(*) FROM "VerseEmbedding";`
Expected: equals the WEB NT verse count (~8k).

- [ ] **Step 5: Commit**

```bash
git add scripts/embed-verses.ts package.json
git commit -m "feat(scripts): add idempotent embed:verses ingestion script"
```

---

## Task 6: Planner integration — gate + `semanticCall` + on-spine ±2 window

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts`
- Modify: `lib/ai/assistant.ts`
- Modify: `tests/unit/lib/ai/retrievalPlanner.test.ts`

- [ ] **Step 1: Extend the `@/lib/search` mock + add gate/semantic tests**

In `tests/unit/lib/ai/retrievalPlanner.test.ts`, add `searchSemantic` to the hoisted mock and the `vi.mock` factory:

```ts
const { getPassage, searchLemma, searchKeyword, searchMorphology, getTopLemmas, findLemmaExamples, searchSemantic } =
  vi.hoisted(() => ({
    getPassage: vi.fn(),
    searchLemma: vi.fn(),
    searchKeyword: vi.fn(),
    searchMorphology: vi.fn(),
    getTopLemmas: vi.fn(),
    findLemmaExamples: vi.fn(),
    searchSemantic: vi.fn()
  }));

vi.mock("@/lib/search", () => ({
  getPassage,
  searchLemma,
  searchKeyword,
  searchMorphology,
  getTopLemmas,
  findLemmaExamples,
  searchSemantic,
  // retrievalPlanner imports this constant from @/lib/search and uses it to label
  // evidence lines. The mock MUST export it or lines render "undefined:".
  SEMANTIC_INDEX_CORPUS: "WEB"
}));
```

In the existing `beforeEach`, add a default so unrelated tests don't break:

```ts
  searchSemantic.mockResolvedValue([]);
```

Also import the gate and update to the new signature:

```ts
import { runRetrievalPlan, shouldRunSemantic } from "@/lib/ai/retrievalPlanner";
```

Append these tests:

```ts
describe("shouldRunSemantic", () => {
  const base: Signals = { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general" };

  it("fires when there are topic words and no exact verse reference", () => {
    expect(shouldRunSemantic({ ...base, topicWords: ["reconciliation"] })).toBe(true);
  });

  it("does not fire without topic words", () => {
    expect(shouldRunSemantic(base)).toBe(false);
  });

  it("does not fire for a single exact verse reference", () => {
    expect(
      shouldRunSemantic({
        ...base,
        topicWords: ["reconciliation"],
        references: [{ book: "2Cor", chapter: 5, verseStart: 18 }]
      })
    ).toBe(false);
  });

  it("still fires for a bare-chapter reference (no verseStart)", () => {
    expect(
      shouldRunSemantic({ ...base, topicWords: ["love"], references: [{ book: "John", chapter: 1 }] })
    ).toBe(true);
  });
});

describe("semanticCall via runRetrievalPlan", () => {
  it("expands each hit to an on-spine ±2 window with per-verse WEB lines", async () => {
    searchSemantic.mockResolvedValueOnce([{ reference: "Eph 2:16", corpus: "WEB", text: "reconcile" }]);
    // SBL window 14..18 has 14,15,16,17,18; WEB has the same → all on-spine.
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number; verseStart: number; verseEnd: number }) => ({
      corpus: input.corpus,
      references: [14, 15, 16, 17, 18].map((verse) => ({
        book: input.book,
        chapter: input.chapter,
        verse,
        reference: `${input.book} ${input.chapter}:${verse}`,
        text: `${input.corpus} ${verse}`
      }))
    }));

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["reconciliation"], morphCodes: [], intent: "general" },
      "what does Paul say about reconciliation"
    );

    expect(searchSemantic).toHaveBeenCalledWith(
      expect.objectContaining({ query: "what does Paul say about reconciliation", keywords: "reconciliation" })
    );
    expect(evidence.formattedEvidence).toContain("Eph 2:16, WEB:");
    expect(evidence.formattedEvidence).toContain("Eph 2:14, WEB:"); // ±2 neighbor
    expect(evidence.citations.some((c) => c.reference === "Eph 2:16" && c.toolName === "searchSemantic")).toBe(true);
  });

  it("omits a window verse missing from the SBL spine", async () => {
    searchSemantic.mockResolvedValueOnce([{ reference: "Acts 8:36", corpus: "WEB", text: "what hinders" }]);
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => {
      if (input.corpus === "SBLGNT") {
        // SBL lacks 8:37 (WEB-only verse) → window returns 34,35,36,38.
        return {
          corpus: "SBLGNT",
          references: [34, 35, 36, 38].map((verse) => ({
            book: input.book, chapter: input.chapter, verse,
            reference: `${input.book} ${input.chapter}:${verse}`, text: `SBLGNT ${verse}`
          }))
        };
      }
      return {
        corpus: "WEB",
        references: [34, 35, 36, 37, 38].map((verse) => ({
          book: input.book, chapter: input.chapter, verse,
          reference: `${input.book} ${input.chapter}:${verse}`, text: `WEB ${verse}`
        }))
      };
    });

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["baptism"], morphCodes: [], intent: "general" },
      "is baptism required"
    );

    expect(evidence.formattedEvidence).toContain("Acts 8:36, WEB:");
    expect(evidence.formattedEvidence).not.toContain("Acts 8:37"); // WEB-only neighbor dropped
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: FAIL — `shouldRunSemantic` not exported; `runRetrievalPlan` does not accept a 2nd arg / no semantic section.

- [ ] **Step 3: Implement in `lib/ai/retrievalPlanner.ts`**

Update the imports:

```ts
import {
  findLemmaExamples,
  getPassage,
  getTopLemmas,
  searchKeyword,
  searchLemma,
  searchMorphology,
  searchSemantic
} from "@/lib/search";
import { parseReference } from "@/lib/references";
```

Add constants near the other `MAX_*` constants:

```ts
// Semantic search: how many fused hits to expand, and the ± window per hit.
const SEMANTIC_HIT_LIMIT = 5;
const SEMANTIC_WINDOW = 2;
```

Add the gate (exported) and the window helper above `buildPlan`:

```ts
// Fire semantic search only for conceptual prompts: there must be topic words AND
// no single pinpointed verse reference (a passage/lemma/morph lookup skips it).
export function shouldRunSemantic(signals: Signals): boolean {
  if (signals.topicWords.length === 0) return false;
  const singleExactVerse =
    signals.references.length === 1 && signals.references[0].verseStart !== undefined;
  return !singleExactVerse;
}

// Build an on-spine ±2 window for a hit: SBLGNT range defines which references are
// citable; WEB supplies readable text (falling back to Greek if WEB lacks a verse).
// A WEB-only verse in the window is omitted because it is absent from the SBL range.
async function expandOnSpineWindow(
  reference: string
): Promise<{ reference: string; text: string }[]> {
  const parsed = parseReference(reference);
  if (!parsed) return [];
  const verseStart = Math.max(1, parsed.verse - SEMANTIC_WINDOW);
  const verseEnd = parsed.verse + SEMANTIC_WINDOW;
  const [sbl, web] = await Promise.all([
    getPassage({ corpus: "SBLGNT", book: parsed.book, chapter: parsed.chapter, verseStart, verseEnd }),
    getPassage({ corpus: "WEB", book: parsed.book, chapter: parsed.chapter, verseStart, verseEnd })
  ]);
  const webText = new Map(web.references.map((r) => [r.verse, r.text]));
  return sbl.references.map((r) => ({
    reference: r.reference,
    text: webText.get(r.verse) ?? r.text
  }));
}

function semanticCall(prompt: string, keywords: string, scope: Scope): PlannedCall {
  const args: { query: string; book?: string } = { query: prompt };
  if (scope.book) args.book = scope.book;
  return {
    key: `semantic:${scope.book ?? ""}`,
    errorTrace: { tool: "searchSemantic", args },
    run: async () => {
      const hits = await searchSemantic({
        query: prompt,
        keywords,
        book: scope.book,
        limit: SEMANTIC_HIT_LIMIT
      });
      const lines: string[] = [];
      const citations: AssistantCitation[] = [];
      const windows = await Promise.all(hits.map((h) => expandOnSpineWindow(h.reference)));
      hits.forEach((hit, i) => {
        const window = windows[i];
        if (window.length === 0) return;
        lines.push(`#### ${hit.reference} (semantic hit)`);
        for (const v of window) lines.push(`- ${v.reference}, ${SEMANTIC_INDEX_CORPUS}: ${v.text}`);
        citations.push({
          reference: hit.reference,
          corpus: SEMANTIC_INDEX_CORPUS,
          searchQuery: "semantic",
          toolName: "searchSemantic"
        });
      });
      return {
        citations: citations.slice(0, MAX_SECTION_LINES),
        section: sectionBlock("searchSemantic — top hits with ±2 context", lines, lines.length),
        traces: [{ tool: "searchSemantic", args }]
      };
    }
  };
}
```

Add `SEMANTIC_INDEX_CORPUS` to the `@/lib/search` import list (it is exported there from Task 3).

Update `buildPlan` to accept the prompt and add the gated call (insert right after the `topicWords` loop, before the `morphCodes` loop):

```ts
function buildPlan(signals: Signals, prompt: string): PlannedCall[] {
```

```ts
  if (shouldRunSemantic(signals)) {
    add(semanticCall(prompt, signals.topicWords.join(" "), scope));
  }
```

Update `runRetrievalPlan` signature and its `buildPlan` call:

```ts
export async function runRetrievalPlan(signals: Signals, prompt = ""): Promise<EvidencePacket> {
  const plan = buildPlan(signals, prompt);
```

- [ ] **Step 4: Thread the prompt from `lib/ai/assistant.ts`**

In `lib/ai/assistant.ts`, change the retrieval call (currently `runRetrievalPlan(signals)`):

```ts
  const evidence = await runRetrievalPlan(signals, prompt);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: PASS (existing + new gate/semantic tests).

- [ ] **Step 6: Full unit suite + typecheck**

Run: `npm run test:unit`
Expected: all green (existing assistant tests unaffected — they mock `runRetrievalPlan`).
Run: `npx tsc --noEmit --pretty false`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/retrievalPlanner.ts lib/ai/assistant.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "feat(assistant): gated semantic retrieval with on-spine ±2 context windows"
```

---

## Task 7: Integration test (real KNN on the Neon branch)

**Files:**
- Create: `tests/integration/semantic-search.test.ts`

> Mirrors `tests/integration/fts-search.test.ts`: gates on `DATABASE_URL`, calls the real `searchSemantic` (shared prisma singleton). Requires the migration applied AND `npm run embed:verses` run against the test branch AND `OPENAI_API_KEY` set (the suite self-skips if either DB or key is absent).

- [ ] **Step 1: Write the test**

```ts
// tests/integration/semantic-search.test.ts
import { describe, expect, it } from "vitest";
import { searchSemantic } from "@/lib/search";

// Needs: lexical_fts + add_verse_embeddings migrations applied, full NT seeded,
// embeddings ingested (npm run embed:verses), and OPENAI_API_KEY set.
const enabled = Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY);

describe.skipIf(!enabled)("semantic search", () => {
  it("retrieves conceptually-related verses for a topical query", async () => {
    const results = await searchSemantic({
      query: "what does Paul say about reconciliation between people and God",
      keywords: "reconciliation",
      limit: 10
    });
    expect(results.length).toBeGreaterThan(0);
    // Every returned reference must be on the SBLGNT spine (filter guarantee).
    expect(results.every((r) => r.corpus === "WEB")).toBe(true);
  }, 30_000);

  it("returns [] for a blank query without an API call", async () => {
    expect(await searchSemantic({ query: "   " })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:integration -- tests/integration/semantic-search.test.ts`
Expected: PASS when the test branch has embeddings + `OPENAI_API_KEY`; otherwise the suite reports as skipped.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/semantic-search.test.ts
git commit -m "test(integration): real semantic KNN against the Neon test branch"
```

---

## Task 8: Acceptance interaction + docs

**Files:**
- Modify: `scripts/acceptance-test.js`
- Modify: `docs/HiFi-exegesis-nt-roadmap.md`, `docs/Project_State.md`, `ReadMe.md`, `docs/security-register.md`

- [ ] **Step 1: Read the acceptance harness to match its interaction style**

Read `scripts/acceptance-test.js` and locate the assistant-interaction block (a prompt POSTed to `/api/assistant`). Add one topical interaction after the existing assistant check, following the exact request/assert shape already used there. The assertion must not pin a semantic result count (embeddings + model output vary); assert only that the response is `200` and `grounded !== false` for a known well-supported topical prompt, e.g.:

```js
// Topical/conceptual prompt — exercises the Phase 4a semantic path (gracefully
// no-ops to deterministic retrieval if OPENAI_API_KEY is unset on the runner).
await assistantAsks("What does the New Testament teach about reconciliation?");
```

Use the existing helper name/shape found in the file (e.g. the function that POSTs to `/api/assistant` and checks `res.status === 200`). Do NOT introduce a count assertion — per the project memory, acceptance assertions are pinned to exact corpus counts and embeddings do not change verse/token totals.

- [ ] **Step 2: Run the acceptance suite**

Requires the test branch with embeddings (or accept the deterministic no-op path).
Run: `npm run test:acceptance`
Expected: exits 0; the new topical interaction returns 200.

- [ ] **Step 3: Update the roadmap**

In `docs/HiFi-exegesis-nt-roadmap.md`, change the Phase 4 entry to mark **Phase 4a done** and **Phase 4b (cross-encoder rerank) deferred**. Replace the existing Phase 4 bullet with:

```markdown
**Phase 4a — Vector + hybrid retrieval. ✅ DONE.** pgvector `VerseEmbedding` table (WEB per-verse,
`text-embedding-3-small`, HNSW/cosine); `searchSemantic` fuses vector KNN + keyword FTS via Reciprocal
Rank Fusion (`lib/search/rrf.ts`), filtered to the SBLGNT spine; gated `semanticCall` in the planner
fires only on topical prompts and expands each hit to an on-spine ±2 window; `npm run embed:verses`
ingestion script. Citations resolve to the SBLGNT spine; WEB-only verses are filtered out of both hits
and ±2 neighbors so semantic retrieval cannot trigger a spurious withholding.

**Phase 4b — Cross-encoder rerank (DEFERRED).** Top-30→top-5 rerank. Deferred because it requires a new
vendor (Cohere/Voyage) or an LLM-as-reranker outside the current OpenAI-only dependency set.
```

- [ ] **Step 4: Update `docs/Project_State.md`**

Bump the snapshot line to "post Milestone 3 Phase 4a — Vector + Hybrid Retrieval" and add to the assistant-pipeline / database / test sections: the `VerseEmbedding` table + migration `20260602120000_add_verse_embeddings`, `searchSemantic`/RRF, the topical gate + on-spine ±2 windows, the `embed:verses` script, and the new unit + integration tests. Add the new migration to the migrations list.

- [ ] **Step 5: Update `ReadMe.md`**

Add a short note under the assistant/search section: hybrid semantic retrieval (vector + FTS RRF) on topical questions, and the one-time `npm run embed:verses` step (requires `OPENAI_API_KEY` + the migration applied).

- [ ] **Step 6: Update `docs/security-register.md`**

Add a note: topical query text and WEB verse text are sent to OpenAI's embeddings endpoint (`text-embedding-3-small`) — same trust boundary as the existing synthesis calls; WEB is public domain. No new secret beyond `OPENAI_API_KEY`.

- [ ] **Step 7: Commit**

```bash
git add scripts/acceptance-test.js docs/HiFi-exegesis-nt-roadmap.md docs/Project_State.md ReadMe.md docs/security-register.md
git commit -m "test+docs: acceptance topical interaction; document Phase 4a"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the full gate**

Run: `npm run verify`
Expected: lint + tsc + build + coverage gate all green (80/80/75/65). The new `lib/` code is covered by Tasks 1, 3, 4, 6 unit tests.

- [ ] **Step 2: Run integration + acceptance (Neon branch with embeddings)**

Run: `npm run test:integration`
Run: `npm run test:acceptance`
Expected: both exit 0.

- [ ] **Step 3: Manual smoke (live mode)**

With `OPENAI_API_KEY` set and embeddings ingested, start the app (`npm run dev`) and ask the assistant: *"What does the New Testament teach about reconciliation?"* Confirm: the tool trace shows a `searchSemantic` entry; citations resolve to real SBLGNT references; the answer is grounded (not withheld). Then ask a deliberately unsupported claim and confirm it is still withheld.

- [ ] **Step 4: Final commit (if any docs/state drift)**

```bash
git add -A
git commit -m "chore: Phase 4a verification follow-ups"
```

---

## Self-review notes (addressed)

- **Spec coverage:** §1 data layer → Task 2; §2 ingestion → Task 5; §3 `searchSemantic`+RRF+SBL filter → Tasks 1,3,4; §4 gate + `semanticCall` + on-spine ±2 + full-prompt embed / keyword FTS + prompt threading → Task 6; §5 grounding unchanged (no task needed; verified manually Task 9); future-proofing `SEMANTIC_INDEX_CORPUS` → Task 3; testing → Tasks 1,3,4,6,7,8; docs → Task 8.
- **Graceful degradation:** `embedQuery` null → `searchSemantic` `[]` → `semanticCall` emits an empty section; covered by Task 4 null-client test and the default `searchSemantic.mockResolvedValue([])` in Task 6.
- **Type consistency:** `RankedRef` (Task 1) is the return type of `searchSemantic` (Task 4) and the input to `semanticCall` (Task 6). `spineKey`/`filterToSblSpine`/`formatVectorLiteral`/`SEMANTIC_INDEX_CORPUS`/`EMBEDDING_MODEL` defined in Task 3 are consumed in Task 4. `shouldRunSemantic` defined and exported in Task 6, tested in Task 6.
- **No count assertion in acceptance** (Task 8) — per project memory, acceptance is pinned to corpus counts; embeddings don't change them, so only status/grounded are asserted.
