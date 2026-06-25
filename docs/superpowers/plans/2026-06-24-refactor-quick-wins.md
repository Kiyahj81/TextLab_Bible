# Refactor Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining low-effort items from the structure review — break the AI contracts type cycle, and (optionally, behind a latency measurement) parallelize the independent fetches on the search page.

**Architecture:** Each task is independent and small. The AI-contracts task introduces `lib/ai/contracts.ts` as the owner of the shared `AssistantCitation` DTO so the orchestrator and planner stop importing types from each other. The search-page task is a behavior-preserving fetch reordering, gated on a measurement that justifies it.

> **README ownership:** the README architecture-table fix lives in **one place only** — Task 7 of `2026-06-24-search-service-split.md`. It is deliberately not here, so the two stale references (`lib/bible.ts`, `lib/search/semantic.ts`) are corrected together, after the split makes `lib/search/semantic.ts` real. Do not edit the README in this plan.

**Tech Stack:** TypeScript 5.8, Next.js 15.3 App Router, Vitest.

## Global Constraints

- **Behavior-preserving.** No runtime logic changes. The AI-contracts task moves a type; the page task reorders awaits without changing what is fetched or rendered.
- **Verification gate per task:** `npm run test:unit` AND `npx tsc --noEmit --pretty false`; `npm run lint` on any task that changes imports.
- **Protected main.** Task 1 ships as a small PR; Task 2 only if its measurement step justifies it. Feature branch, commit per task.
- These tasks are **independent of** the two P1 split plans and can land before or after them.

---

## Task 1: Move `AssistantCitation` into `lib/ai/contracts.ts` (break the type cycle)

**Problem:** [retrievalPlanner.ts:1](../../../lib/ai/retrievalPlanner.ts) imports `type AssistantCitation` from [assistant.ts:11](../../../lib/ai/assistant.ts), while `assistant.ts` imports `EvidencePacket`/`runRetrievalPlan` back from `retrievalPlanner.ts` — a type-level cycle that gives the orchestrator ownership of a DTO the planner produces. (`AssistantCitation` has three importers: `assistant.ts`, `retrievalPlanner.ts`, `synthesis.ts`.)

**Files:**
- Create: `lib/ai/contracts.ts`
- Modify: `lib/ai/assistant.ts`, `lib/ai/retrievalPlanner.ts`, `lib/ai/synthesis.ts`

**Interfaces:**
- Produces (from `lib/ai/contracts.ts`): `type AssistantCitation`.
- Consumes: nothing (self-contained primitive type).

- [ ] **Step 1: Create `lib/ai/contracts.ts`** with the `AssistantCitation` type moved **verbatim** from `assistant.ts:23-32`:
```ts
export type AssistantCitation = {
  reference: string;
  corpus: string;
  searchQuery: string;
  toolName?: string;
  book?: string;
  chapter?: number;
  verse?: number;
  tokenId?: string;
};
```

- [ ] **Step 2: Update `lib/ai/assistant.ts`** — delete the inline `AssistantCitation` definition (23-32) and add an import + back-compat re-export near the top:
```ts
import type { AssistantCitation } from "@/lib/ai/contracts";
export type { AssistantCitation } from "@/lib/ai/contracts";
```
(The re-export keeps any external `@/lib/ai/assistant` importer working; `assistant.ts` still references `AssistantCitation` internally in `AssistantAnswer`/citation typing.)

- [ ] **Step 3: Update `lib/ai/retrievalPlanner.ts:1`** — change the import source:
```ts
// before: import type { AssistantCitation } from "@/lib/ai/assistant";
import type { AssistantCitation } from "@/lib/ai/contracts";
```
This is the edit that removes the planner→orchestrator edge and breaks the cycle.

- [ ] **Step 4: Update `lib/ai/synthesis.ts`** — repoint its `AssistantCitation` import to `@/lib/ai/contracts` (find the existing `import ... AssistantCitation ... from "@/lib/ai/assistant"` and change the source to `"@/lib/ai/contracts"`). If `synthesis.ts` imports other symbols from `assistant.ts` in the same statement, split out only `AssistantCitation`.

- [ ] **Step 5: Verify**
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run test:unit
```
Expected: pass (`tests/unit/lib/ai/retrievalPlanner.test.ts`, `assistant.test.ts`, plus the assistant route/guardrail tests). Lint should report no remaining `@/lib/ai/assistant` → `AssistantCitation` import in `retrievalPlanner.ts`.

- [ ] **Step 6: Commit**
```bash
git add lib/ai/contracts.ts lib/ai/assistant.ts lib/ai/retrievalPlanner.ts lib/ai/synthesis.ts
git commit -m "refactor(ai): own AssistantCitation in lib/ai/contracts; break planner/orchestrator type cycle"
```

---

## Task 2 (OPTIONAL — gated on measurement): Overlap independent fetches with the search in `app/search/page.tsx`

**Problem & caveat:** [page.tsx:48](../../../app/search/page.tsx) awaits `getLouwNidaDomainOptions()` alone, then runs the search, then [page.tsx:123](../../../app/search/page.tsx) awaits `getAvailableReaderBooks()` + saved searches. `domainOptions`, `books`, and `savedSearches` are mutually independent **and** independent of the search itself — so the real win is overlapping them with the (often slower) search query, not merely with each other. A single up-front `await Promise.all([...metadata])` would still serialize *metadata-then-search*; it must instead **start** the metadata promises, **run the search**, then **await** the metadata only at the points that consume it. Codex's guidance: **do this only after measuring page latency** — if the page is already fast, skip it.

**Files:**
- Modify: `app/search/page.tsx`

- [ ] **Step 1: Measure first.** Load `/search?mode=keyword&q=love` against the dev server and record server render time (Next.js server timing / a `console.time` around the data section). If the serial fetches contribute < ~50ms, **stop — do not implement this task**; record the measurement in the PR/issue and close the item. Only proceed if the measurement shows a worthwhile win.

- [ ] **Step 2 (only if justified): Kick off the three independent fetches, then run the search, then await on use.** Near the top (after `userId`/params parsing, replacing the standalone `const domainOptions = await getLouwNidaDomainOptions();` at line 48) start the promises **without awaiting**:
```ts
// Independent of the search and of each other — start them now so they run
// concurrently WITH the search query below, then await at point of use.
const domainOptionsPromise = getLouwNidaDomainOptions();
const booksPromise = getAvailableReaderBooks();
const savedSearchesPromise = prisma.savedSearch.findMany({
  where: { userId },
  orderBy: { updatedAt: "desc" },
  take: 25
});

// Passive observer: if the search branch below throws before we reach the
// awaits, these eagerly-started promises would otherwise reject "unhandled"
// (Node UnhandledPromiseRejection noise, e.g. when a DB outage fails both the
// search AND these). allSettled attaches a handler to each WITHOUT swallowing
// them — the real `await Promise.all(...)` on the success path still surfaces
// any genuine rejection. (Prefix with `void`/assign to `_` if the repo's lint
// flags the unawaited promise.)
void Promise.allSettled([domainOptionsPromise, booksPromise, savedSearchesPromise]);
```
The search branch (65-121) stays exactly as-is and runs immediately, overlapping the three in-flight fetches. Then make two point-of-use changes:
  1. In the domain branch, the label line becomes (await the already-in-flight promise; it is typically resolved by now):
```ts
searchLabel = domainSearchLabel(search.filter, await domainOptionsPromise) + scopeSuffix(book, parsedChapter);
```
  2. Replace the trailing `const [books, savedSearches] = await Promise.all([...])` block (123-130) with a single await that also resolves `domainOptions` for the render (awaiting a settled promise again is a no-op):
```ts
const [domainOptions, books, savedSearches] = await Promise.all([
  domainOptionsPromise,
  booksPromise,
  savedSearchesPromise
]);
```
`domainOptions` is now in scope for the `SearchPanel` render at the bottom, and the search executed concurrently with all three fetches. Nothing about what is fetched or rendered changes — only when the awaits resolve.

- [ ] **Step 3: Verify**
```bash
npx tsc --noEmit --pretty false
npm run test:unit
```
Expected: pass. The page renders identically; only fetch ordering changed. If the test DB is reachable, also run `npm run test:acceptance` to confirm the `/search` flow end-to-end. Confirm the server logs show **no `UnhandledPromiseRejection` warnings** — the `Promise.allSettled` observer covers the search-throws-before-await path.

- [ ] **Step 4: Commit (only if Step 2 ran)**
```bash
git add app/search/page.tsx
git commit -m "perf(search): overlap domain-option/book/saved-search fetches with the search query"
```

---

## Deferred (not planned here): split `scripts/import-open-bible.ts`

Codex rates this **P2 and explicitly deferrable**: the 863-line script "correctly handles three import flows and parsers" and should be split into source-specific parsers + import services **before OT/LXX corpus expansion** — "Defer it if NT imports remain stable." Per the `acceptance-needs-full-corpus` note the NT corpus is loaded and stable, so there is no trigger today.

**Trigger to revisit:** when work begins on OT or LXX corpus import (new source format/parser). At that point, plan it as: (a) extract one parser module per source format, (b) extract a shared import-service (run bookkeeping, upsert, progress) the parsers feed, (c) thin the CLI entry to argument parsing + dispatch. Do not undertake it speculatively now.

## Self-Review

- **Spec coverage:** Codex P2 #1 (AI contracts) → Task 1; search-page serialization → Task 2 (overlapping search with metadata, behind the measurement gate Codex required); README correction → owned solely by `2026-06-24-search-service-split.md` Task 7; `import-open-bible.ts` → explicitly deferred with its documented trigger. ✅
- **Placeholder scan:** no TBD; every edit names the exact file/line and shows the replacement text. ✅
- **Type/name consistency:** `AssistantCitation` is defined once in `contracts.ts` and imported by name in all three consumers; the re-export in `assistant.ts` preserves the old import path. ✅
- **Overlap correctness (Task 2):** the metadata promises are *started* before the search and *awaited* only at point of use (domain label, render), so the search runs concurrently with all three fetches — not after them. ✅
- **No dangling rejections (Task 2):** a `Promise.allSettled` passive observer marks the eagerly-started promises handled if the search throws before the awaits, without swallowing genuine errors on the success path. ✅
