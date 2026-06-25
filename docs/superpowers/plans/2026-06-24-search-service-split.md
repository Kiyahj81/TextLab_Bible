# Search Service Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 918-line `lib/search.ts` into five focused modules behind a re-export facade, with zero behavior change and the entire existing test suite staying green.

**Architecture:** `lib/search.ts` becomes a thin barrel (`export *` from six new files in `lib/search/`). Each public function moves verbatim into the module that owns its responsibility — reader/passage, keyword, tokens, domain, semantic, and a shared-contract module for spine/pagination/hydration primitives. All 26 current importers (app routes, AI pipeline, every search test) import unchanged because the facade preserves the exact public surface.

**Tech Stack:** TypeScript 5.8, Next.js 15.3, Prisma 6.7, Vitest. `moduleResolution: bundler`, `isolatedModules: true` (so `export *` barrels carry both types and values; `@/lib/search` resolves to the file `lib/search.ts`, never the directory).

## Global Constraints

- **Behavior-preserving only.** Move code verbatim. No logic edits, no signature changes, no renames of any exported symbol. If a diff changes runtime behavior, it is wrong.
- **Facade preserves the public surface.** After every task, `lib/search.ts` must re-export the identical set of named exports it does today. Do not delete the `lib/search.ts` file — it stays as the barrel.
- **Existing tests are the safety net.** Do not add tests that assert new behavior. Add only the one characterization guard in Task 1 (a barrel-surface test) to lock the public API.
- **Verification gate per task:** `npm run test:unit` (vitest) AND `npx tsc --noEmit --pretty false` must both pass before committing. `npm run lint` must pass on the final task.
- **Protected main.** Land as a single PR (the `gate` status check must pass, strict up-to-date). Commit per task on a feature branch; do not push to `main` directly.
- **Module resolution note:** import the new submodules with explicit subpaths (`@/lib/search/shared`, etc.). The facade uses `export * from "@/lib/search/<module>"`.

---

## File Structure

New files under `lib/search/` (joining existing `rerank.ts`, `rrf.ts`, `semanticIndex.ts`):

| File | Responsibility | Exports moved from `lib/search.ts` |
| --- | --- | --- |
| `lib/search/shared.ts` | Spine + pagination + token hydration primitives shared by every search | `spineKey`, `filterToSblSpine`, `SearchPagination`, `Citation`; private `PaginationInput`, `normalizePagination`, `paginationResult`, `HydratedToken`, `hydrateTokens` |
| `lib/search/reader.ts` | Reader & passage assembly | `getAvailablePassages`, `getAvailableReaderBooks`, `PassageNeighbor`, `getPassageNeighbors`, `getReaderPassage`, `getPassage`; private `PassageInput`, `collectEnglishHighlights`, `latestHighlightColor` |
| `lib/search/keyword.ts` | Full-text keyword search | `searchKeyword` |
| `lib/search/tokens.ts` | Lemma / morphology / lemma-example / top-lemma token search | `searchLemma`, `searchMorphology`, `findLemmaExamples`, `LEMMA_STOP_WORDS`, `CONTENT_PART_OF_SPEECH`, `getTopLemmas` |
| `lib/search/domain.ts` | Louw–Nida domain search & options | `DomainFilter`, `normalizeDomainCode`, `resolveDomainFilter`, `domainTokenWhere`, `searchDomain`, `DomainOption`, `DomainOptions`, `getLouwNidaDomainOptions` |
| `lib/search/semantic.ts` | Hybrid vector/FTS semantic retrieval | `embedQuery`, `searchSemantic`, `searchSemanticDetailed`, `SemanticRerankStatus`, `SemanticRerankTrace`, `SemanticSearchDetailedResult`; private `SemanticRow`, `RERANK_CANDIDATE_LIMIT`, `SemanticSearchInput`, `semanticResult`; **plus** the `EMBEDDING_MODEL`, `SEMANTIC_INDEX_CORPUS`, `embeddingTextHash`, `formatVectorLiteral` passthrough re-export currently at `lib/search.ts:12-17` |
| `lib/search.ts` | **Facade barrel** (kept) | `export *` from the six modules above |

**Dependency graph (no cycles):** `shared` and `reader` are standalone. `keyword`, `tokens`, `domain`, `semantic` each import only from `./shared` (plus existing libs). Extraction order below follows this: `shared` first, then the rest.

**Current line ranges in `lib/search.ts`** (for verbatim moves):

- `1-10` imports · `12-17` semanticIndex passthrough re-export
- `19-25` `PassageInput` (→reader) · `27-30` `PaginationInput` (→shared)
- `32-37` `SearchPagination` (→shared) · `39-44` `Citation` (→shared)
- `46-48` `spineKey` (→shared) · `50-65` `filterToSblSpine` (→shared)
- `67-73` `embedQuery` · `75` `SemanticRow` · `77-112` semantic consts/types/`semanticResult` · `114-205` `searchSemantic`/`searchSemanticDetailed` (→semantic)
- `207-228` `getAvailablePassages` · `230-243` `getAvailableReaderBooks` · `245-271` `PassageNeighbor`/`getPassageNeighbors` · `273-392` `getReaderPassage` · `394-415` `collectEnglishHighlights`/`latestHighlightColor` · `417-441` `getPassage` (→reader)
- `443-567` `searchKeyword` (→keyword)
- `569-613` `searchLemma` · `615-660` `searchMorphology` · `662-701` `findLemmaExamples` · `703-706` `LEMMA_STOP_WORDS`/`CONTENT_PART_OF_SPEECH` · `708-734` `getTopLemmas` (→tokens)
- `736-765` `DomainFilter`/`normalizeDomainCode`/`resolveDomainFilter`/`domainTokenWhere` · `767-821` `searchDomain` · `823-848` `DomainOption`/`DomainOptions`/`getLouwNidaDomainOptions` (→domain)
- `850-867` `normalizePagination`/`paginationResult` · `869-918` `HydratedToken`/`hydrateTokens` (→shared)

---

## Task 1: Extract `lib/search/shared.ts` (foundation) + lock the public surface

**Files:**
- Create: `lib/search/shared.ts`
- Create: `tests/unit/lib/search-facade.test.ts`
- Modify: `lib/search.ts` (remove moved code, add facade re-export for shared)

**Interfaces:**
- Produces (from `lib/search/shared.ts`): `spineKey(book: string, chapter: number, verse: number): string`; `filterToSblSpine(refs: { book: string; chapter: number; verse: number }[]): Promise<Set<string>>`; type `SearchPagination`; type `Citation`; and (for later tasks) `normalizePagination(input: PaginationInput)`, `paginationResult(pagination: { page: number; pageSize: number }, total: number): SearchPagination`, `hydrateTokens(tokens: HydratedToken[], withEnglish?: boolean)`, type `PaginationInput`, type `HydratedToken`.
- Consumes: `prisma` (`@/lib/db`), `formatReference` (`@/lib/references`). (No `Prisma` namespace — see the header note in Step 1.)

- [ ] **Step 1: Create `lib/search/shared.ts` with the moved primitives**

Header (note: **no** `import { Prisma } from "@prisma/client"` — none of the shared-bound code uses the `Prisma` namespace; that import lives only in keyword/tokens/domain/semantic. Including it here would fail the final `eslint --max-warnings=0`):
```ts
import { prisma } from "@/lib/db";
import { formatReference } from "@/lib/references";
```
Then move **verbatim** from `lib/search.ts`, exported (keep `export` on `PaginationInput`? — it is currently a non-exported local; export it so other modules can import it): the `PaginationInput` type (27-30, add `export`), `SearchPagination` (32-37), `Citation` (39-44), `spineKey` (46-48), `filterToSblSpine` (50-65), `normalizePagination` (850-859, add `export`), `paginationResult` (861-867, add `export`), `HydratedToken` (869-878, add `export`), `hydrateTokens` (880-918, add `export`). Only added word is `export` on the five previously-private symbols; bodies unchanged.

> **Public-surface note:** the five newly-`export`ed symbols (`PaginationInput`, `normalizePagination`, `paginationResult`, `HydratedToken`, `hydrateTokens`) are exported from `shared.ts` **only so sibling submodules can import them directly** via `@/lib/search/shared`. They must **not** reach the `@/lib/search` facade — see Step 3, which re-exports `shared` by name (not `export *`) to keep them internal.

- [ ] **Step 2: Add a public-surface characterization test (exact keys + type guard)**

This guards every later task in **both** directions: a dropped public export *and* a leaked internal helper (e.g. `hydrateTokens`) both fail it. The runtime block asserts an **exact** key set (`toEqual`, not `toContain`); a separate compile-time block (checked by `tsc --noEmit`, since the file is in the tsconfig glob) guards the type-only exports that never appear at runtime.

```ts
// tests/unit/lib/search-facade.test.ts
import { describe, it, expect } from "vitest";
import * as search from "@/lib/search";
import type {
  SearchPagination, Citation, PassageNeighbor,
  SemanticRerankStatus, SemanticRerankTrace, SemanticSearchDetailedResult,
  DomainFilter, DomainOption, DomainOptions
} from "@/lib/search";

// The EXACT runtime surface of @/lib/search as it exists today. The facade must
// re-export these and ONLY these — no internal helper (hydrateTokens,
// normalizePagination, paginationResult, PaginationInput, HydratedToken) may leak.
const RUNTIME_EXPORTS = [
  "spineKey", "filterToSblSpine",
  "embedQuery", "searchSemantic", "searchSemanticDetailed",
  "EMBEDDING_MODEL", "SEMANTIC_INDEX_CORPUS", "embeddingTextHash", "formatVectorLiteral",
  "getAvailablePassages", "getAvailableReaderBooks", "getPassageNeighbors",
  "getReaderPassage", "getPassage", "searchKeyword",
  "searchLemma", "searchMorphology", "findLemmaExamples",
  "LEMMA_STOP_WORDS", "CONTENT_PART_OF_SPEECH", "getTopLemmas",
  "normalizeDomainCode", "resolveDomainFilter", "domainTokenWhere",
  "searchDomain", "getLouwNidaDomainOptions"
].sort();

describe("@/lib/search public surface", () => {
  it("re-exports EXACTLY the original runtime symbols — none missing, no leaked internals", () => {
    expect(Object.keys(search).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it("preserves the public type exports (compile-time guard)", () => {
    // `assertType`'s parameter tuple references every public type, so removing any
    // one from @/lib/search breaks `tsc --noEmit`. Types are erased at runtime, so
    // they cannot be asserted in the runtime block above. `_args` is `_`-prefixed
    // for no-unused-vars; `assertType` is consumed by the expect below.
    const assertType = (..._args: [
      SearchPagination, Citation, PassageNeighbor,
      SemanticRerankStatus, SemanticRerankTrace, SemanticSearchDetailedResult,
      DomainFilter, DomainOption, DomainOptions
    ]) => undefined;
    expect(typeof assertType).toBe("function");
  });
});
```

`RUNTIME_EXPORTS` is the 26-name set of value exports in `lib/search.ts` today (the four `EMBEDDING_MODEL`-family passthroughs + `spineKey`/`filterToSblSpine` + the reader/keyword/token/domain/semantic functions and constants). If `Object.keys(search)` includes an extra name (a leaked internal) or is missing one, the test fails.

- [ ] **Step 3: Update `lib/search.ts`** — delete the moved blocks (lines 27-65 and 850-918 of the original) and add at the top of the file, below remaining imports, a **named** re-export of only `shared`'s original public symbols (NOT `export *`, which would leak the four internal helpers):
```ts
export { spineKey, filterToSblSpine } from "@/lib/search/shared";
export type { SearchPagination, Citation } from "@/lib/search/shared";
```
Within `lib/search.ts`, the still-present functions (`searchKeyword`, `searchSemanticDetailed`, the token/domain searches) reference `spineKey`, `filterToSblSpine`, `normalizePagination`, `paginationResult`, `hydrateTokens`. Add an import so they resolve while the rest is still in-file:
```ts
import {
  spineKey, filterToSblSpine, normalizePagination, paginationResult, hydrateTokens,
  type PaginationInput, type HydratedToken
} from "@/lib/search/shared";
```
(These local imports get removed in later tasks as each consumer moves out.)

- [ ] **Step 4: Verify** — Run:
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: all tests pass (incl. the new `search-facade.test.ts`); no type errors.

- [ ] **Step 5: Commit**
```bash
git add lib/search/shared.ts lib/search.ts tests/unit/lib/search-facade.test.ts
git commit -m "refactor(search): extract shared spine/pagination/hydration into lib/search/shared"
```

---

## Task 2: Extract `lib/search/reader.ts`

**Files:**
- Create: `lib/search/reader.ts`
- Modify: `lib/search.ts`

**Interfaces:**
- Produces: `getAvailablePassages()`, `getAvailableReaderBooks()`, type `PassageNeighbor`, `getPassageNeighbors(bookInput, chapter)`, `getReaderPassage(bookInput?, chapter?, userId?)`, `getPassage(input)`.
- Consumes: `prisma`, `bookName`/`formatReference`/`normalizeBook` (`@/lib/references`), `resolveTokenDomains` (`@/lib/louwNida`). Does **not** import `./shared` (no shared deps).

- [ ] **Step 1: Create `lib/search/reader.ts`** with header:
```ts
import { prisma } from "@/lib/db";
import { bookName, formatReference, normalizeBook } from "@/lib/references";
import { resolveTokenDomains } from "@/lib/louwNida";
```
Move **verbatim** (with `export` kept/added as noted): `PassageInput` type (19-25, keep local — only `getPassage` uses it, no `export` needed), `getAvailablePassages` (207-228), `getAvailableReaderBooks` (230-243), `PassageNeighbor` + `getPassageNeighbors` (245-271), `getReaderPassage` (273-392), `collectEnglishHighlights` + `latestHighlightColor` (394-415, stay private), `getPassage` (417-441).

- [ ] **Step 2: Update `lib/search.ts`** — delete the moved blocks; replace the shared-import-only-for-reader (none) and add to the facade region:
```ts
export * from "@/lib/search/reader";
```

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass. (`tests/unit/lib/getReaderPassage-notes.test.ts`, `search-getPassageNeighbors.test.ts` exercise this module via the facade.)

- [ ] **Step 4: Commit**
```bash
git add lib/search/reader.ts lib/search.ts
git commit -m "refactor(search): extract reader/passage assembly into lib/search/reader"
```

---

## Task 3: Extract `lib/search/keyword.ts`

**Files:**
- Create: `lib/search/keyword.ts`
- Modify: `lib/search.ts`

**Interfaces:**
- Produces: `searchKeyword(input)` — signature and return shape unchanged.
- Consumes from `./shared`: `spineKey`, `filterToSblSpine`, `normalizePagination`, `paginationResult`, type `PaginationInput`. Other: `Prisma`/`prisma`, `formatReference`/`normalizeBook` (`@/lib/references`), `parseHeadlineSegments`/`HEADLINE_OPTIONS` (`@/lib/search-highlight`).

- [ ] **Step 1: Create `lib/search/keyword.ts`** with header:
```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";
import { parseHeadlineSegments, HEADLINE_OPTIONS } from "@/lib/search-highlight";
import {
  spineKey, filterToSblSpine, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";
```
Move `searchKeyword` (443-567) **verbatim**.

- [ ] **Step 2: Update `lib/search.ts`** — delete `searchKeyword`; add `export * from "@/lib/search/keyword";`. Remove `spineKey, filterToSblSpine` from the local shared-import if no remaining in-file function uses them (semantic still does until Task 6 — keep until then).

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass (`tests/unit/lib/search-keyword.test.ts`, `tests/integration/fts-search.test.ts`).

- [ ] **Step 4: Commit**
```bash
git add lib/search/keyword.ts lib/search.ts
git commit -m "refactor(search): extract keyword FTS into lib/search/keyword"
```

---

## Task 4: Extract `lib/search/tokens.ts`

**Files:**
- Create: `lib/search/tokens.ts`
- Modify: `lib/search.ts`

**Interfaces:**
- Produces: `searchLemma(input)`, `searchMorphology(input)`, `findLemmaExamples(input)`, `getTopLemmas(input)`, `LEMMA_STOP_WORDS`, `CONTENT_PART_OF_SPEECH` — all unchanged.
- Consumes from `./shared`: `hydrateTokens`, `normalizePagination`, `paginationResult`, type `PaginationInput`. Other: `Prisma`/`prisma`, `normalizeBook` (`@/lib/references`), `normalizeMorphCodeQuery` (`@/lib/morphology`).

- [ ] **Step 1: Create `lib/search/tokens.ts`** with header:
```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeBook } from "@/lib/references";
import { normalizeMorphCodeQuery } from "@/lib/morphology";
import {
  hydrateTokens, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";
```
Move **verbatim**: `searchLemma` (569-613), `searchMorphology` (615-660), `findLemmaExamples` (662-701), `LEMMA_STOP_WORDS`/`CONTENT_PART_OF_SPEECH` (703-706), `getTopLemmas` (708-734).

- [ ] **Step 2: Update `lib/search.ts`** — delete the moved blocks; add `export * from "@/lib/search/tokens";`. Drop now-unused `hydrateTokens` from the in-file shared-import if `searchDomain` (still in-file until Task 5) is the only other user — keep until Task 5.

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass (`tests/unit/lib/search-findLemmaExamples.test.ts`, `search.test.ts`).

- [ ] **Step 4: Commit**
```bash
git add lib/search/tokens.ts lib/search.ts
git commit -m "refactor(search): extract lemma/morphology token search into lib/search/tokens"
```

---

## Task 5: Extract `lib/search/domain.ts`

**Files:**
- Create: `lib/search/domain.ts`
- Modify: `lib/search.ts`

**Interfaces:**
- Produces: type `DomainFilter`, `normalizeDomainCode(value)`, `resolveDomainFilter(input)`, `domainTokenWhere(filter, domainCodes)`, `searchDomain(input)`, type `DomainOption`, type `DomainOptions`, `getLouwNidaDomainOptions()` — unchanged.
- Consumes from `./shared`: `hydrateTokens`, `normalizePagination`, `paginationResult`, type `PaginationInput`. Other: `Prisma`/`prisma`, `normalizeBook` (`@/lib/references`).

- [ ] **Step 1: Create `lib/search/domain.ts`** with header:
```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeBook } from "@/lib/references";
import {
  hydrateTokens, normalizePagination, paginationResult, type PaginationInput
} from "@/lib/search/shared";
```
Move **verbatim**: `DomainFilter` (736-739), `normalizeDomainCode` (741-747), `resolveDomainFilter` (749-758), `domainTokenWhere` (760-765), `searchDomain` (767-821), `DomainOption`/`DomainOptions` (823-827), `getLouwNidaDomainOptions` (829-848).

- [ ] **Step 2: Update `lib/search.ts`** — delete the moved blocks; add `export * from "@/lib/search/domain";`. Remove `hydrateTokens` from the in-file shared-import (no longer used in-file).

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass (`tests/unit/lib/search-domain.test.ts`, `tests/integration/louw-nida-search.test.ts`).

- [ ] **Step 4: Commit**
```bash
git add lib/search/domain.ts lib/search.ts
git commit -m "refactor(search): extract Louw-Nida domain search into lib/search/domain"
```

---

## Task 6: Extract `lib/search/semantic.ts` and reduce `lib/search.ts` to a pure facade

**Files:**
- Create: `lib/search/semantic.ts`
- Modify: `lib/search.ts`

**Interfaces:**
- Produces: `embedQuery(text)`, `searchSemantic(input)`, `searchSemanticDetailed(input)`, types `SemanticRerankStatus`/`SemanticRerankTrace`/`SemanticSearchDetailedResult`, and the passthrough re-exports `EMBEDDING_MODEL`, `SEMANTIC_INDEX_CORPUS`, `embeddingTextHash`, `formatVectorLiteral`.
- Consumes from `./shared`: `spineKey`, `filterToSblSpine`. Other: `getOpenAi` (`@/lib/ai/openaiClient`), `reciprocalRankFusion`+`RankedRef` (`@/lib/search/rrf`), `EMBEDDING_MODEL`/`SEMANTIC_INDEX_CORPUS`/`formatVectorLiteral` (`@/lib/search/semanticIndex`), `rerankCandidates` (`@/lib/search/rerank`), `Prisma`/`prisma`, `formatReference`/`normalizeBook` (`@/lib/references`).

- [ ] **Step 1: Create `lib/search/semantic.ts`** with header:
```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatReference, normalizeBook } from "@/lib/references";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";
import { EMBEDDING_MODEL, SEMANTIC_INDEX_CORPUS, formatVectorLiteral } from "@/lib/search/semanticIndex";
import { rerankCandidates } from "@/lib/search/rerank";
import { spineKey, filterToSblSpine } from "@/lib/search/shared";

export {
  EMBEDDING_MODEL,
  SEMANTIC_INDEX_CORPUS,
  embeddingTextHash,
  formatVectorLiteral
} from "@/lib/search/semanticIndex";
```
Move **verbatim**: `embedQuery` (67-73), `SemanticRow` (75), the comment block + `RERANK_CANDIDATE_LIMIT` (77-87), `SemanticSearchInput` (89-96), `SemanticRerankStatus`/`SemanticRerankTrace` (98-103), `SemanticSearchDetailedResult` (105-108), `semanticResult` (110-112), `searchSemantic` (114-116), `searchSemanticDetailed` (118-205).

- [ ] **Step 2: Reduce `lib/search.ts` to the facade.** After this task the file is only:
```ts
// `shared` is re-exported BY NAME (not `export *`) so its internal helpers
// (PaginationInput, normalizePagination, paginationResult, HydratedToken,
// hydrateTokens) stay private to lib/search/*. The other five modules export
// only originally-public symbols, so `export *` is leak-free for them.
export { spineKey, filterToSblSpine } from "@/lib/search/shared";
export type { SearchPagination, Citation } from "@/lib/search/shared";
export * from "@/lib/search/reader";
export * from "@/lib/search/keyword";
export * from "@/lib/search/tokens";
export * from "@/lib/search/domain";
export * from "@/lib/search/semantic";
```
Delete all remaining moved code and now-unused local imports. Confirm no duplicate export names exist across the six modules (there are none: `spineKey`/`filterToSblSpine` live only in `shared`; the `EMBEDDING_MODEL` family only in `semantic`). The `search-facade.test.ts` exact-key assertion from Task 1 is the proof the surface is unchanged.

- [ ] **Step 3: Verify (full gate)**
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run test:unit
```
Expected: lint clean (no unused imports left behind), no type errors, all unit tests pass (incl. `tests/unit/lib/search-semantic.test.ts`, `tests/integration/semantic-search.test.ts` when run via `test:integration`).

- [ ] **Step 4: Run the integration AND acceptance suites — required when the test DB is reachable.** Per the `neon-test-branch-connected` and `acceptance-needs-full-corpus` memories, `.env.test` points at the Neon integration/acceptance branch with the full NT corpus, so these are expected to be runnable and must not be silently skipped:
```bash
npm run test:integration
npm run test:acceptance
```
Expected: both pass **unchanged** — this refactor is behavior-preserving, so the acceptance script's corpus-count assertions (e.g. the "40 results for lemma λόγος" search flow at `scripts/acceptance-test.js:208-218`) and the integration FTS/semantic/domain suites must stay green with no edits. Only if the DB is genuinely unreachable (preflight fails) may you defer to the PR `gate` check — and then state explicitly in the PR that integration/acceptance were not run locally and why.

- [ ] **Step 5: Commit**
```bash
git add lib/search/semantic.ts lib/search.ts
git commit -m "refactor(search): extract semantic retrieval; reduce lib/search to a facade barrel"
```

---

## Task 7: Update the README architecture table (single authoritative doc task)

**This is the ONLY README task across all three refactor plans** — the quick-wins plan no longer touches the README, to avoid split ownership. It runs last in this plan so every file it names already exists post-split. It fixes both stale references at once: the nonexistent `lib/bible.ts` (Reader/search row) and the now-real `lib/search/semantic.ts` (Semantic retrieval row).

**Files:**
- Modify: `README.md:49`, `README.md:51`
- Check (edit only if stale): `docs/PROJECT_STATE.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Fix the "Reader/search data" row (line 49)** — remove the nonexistent `lib/bible.ts`; the facade `lib/search.ts` plus the real sibling helpers are the canonical surface:
```
| Reader/search data | `lib/search.ts` (facade), `lib/search/reader.ts`, `lib/louwNida.ts`, `lib/references.ts`, `lib/searchLabel.ts`, `lib/morphology.ts` | Canonical passage, token, search, domain, and reference helpers, plus the `readerHref` link builder, result-label formatting, and the morphology-code decoder/normalizer. |
```

- [ ] **Step 2: Fix the "Semantic retrieval" row (line 51)** — name the real modules, including the `semantic.ts` this plan just created:
```
| Semantic retrieval | `lib/search/semantic.ts`, `lib/search/semanticIndex.ts`, `lib/search/rrf.ts`, `lib/search/rerank.ts`, `scripts/embed-verses.ts` | pgvector embeddings, hybrid RRF retrieval, and optional Voyage rerank through Vercel AI Gateway. |
```

- [ ] **Step 3: Check `docs/PROJECT_STATE.md`** — `CLAUDE.md` requires checking both `README.md` and `docs/PROJECT_STATE.md` after major changes. Read `docs/PROJECT_STATE.md` and edit it **only if** the split makes any file-ownership / module-structure reference stale (e.g. it points at `lib/search.ts` as a monolith or names `lib/bible.ts`). If nothing is stale, make no edit and state "no change needed — PROJECT_STATE.md has no stale search-module references."

- [ ] **Step 4: Read-through check** — per `CLAUDE.md`, confirm the README still reads as one coherent document and the table renders. Then `npm run lint` to confirm a clean working tree before committing.

- [ ] **Step 5: Commit**
```bash
git add README.md docs/PROJECT_STATE.md
git commit -m "docs(readme): correct architecture table — drop nonexistent lib/bible.ts; name real semantic modules"
```

---

## Self-Review

- **Spec coverage:** Codex P1 #1 ("split `lib/search.ts` into reader/passage, keyword, token/domain, semantic, shared-contract modules; retain a temporary re-export facade") — Tasks 1-6 cover all five areas (token + domain split into two focused files, a cleaner-than-asked outcome) and keep the facade. ✅
- **Placeholder scan:** no TBD/TODO; every move names exact symbols + original line ranges; new code (facade, shared header, characterization test) shown in full. ✅
- **Type/name consistency:** the `Produces`/`Consumes` blocks use the same symbol names as the move lists; `PaginationInput`/`HydratedToken`/`normalizePagination`/`paginationResult`/`hydrateTokens` are exported from `shared` in Task 1 and imported by Tasks 3/4/5/6 under those exact names. The facade re-exports `shared` **by name** (so those five stay internal) and `export *`s the five leak-free modules. ✅
- **Surface integrity:** `tests/unit/lib/search-facade.test.ts` asserts the **exact** runtime key set (catches both dropped exports and leaked internals) plus a `tsc`-checked type guard for the nine public types. ✅
- **Risk:** the only non-mechanical edits are adding `export` to five formerly-private `shared` symbols and writing the named-vs-`*` facade. The facade test plus the existing per-area suites (and integration/acceptance in Task 6) catch any surface drift.

## Execution Handoff

See the roadmap note in the chat response for sequencing against the SearchPanel split.
