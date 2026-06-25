# SearchPanel Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 822-line `components/SearchPanel.tsx` into a thin composition root plus focused form, results, saved-search sidebar, a saved-search hook/API client, and presentational helpers — with identical rendered markup and the existing test suite green throughout.

**Architecture:** `components/SearchPanel.tsx` keeps its public name and props but becomes a layout shell that wires together `SearchForm` (owns the GET `<form>` and its local input state), `SearchResults` (owns result rendering, the show-English preference, the save button, and pagination), `SavedSearches` (the sidebar), and a `useSavedSearches` hook (all persistence state + `/api/saved-searches` fetch calls). Pure pieces (constants, types, `searchHref`, highlight components) move into small siblings under `components/search/`. The split is leaf-first so each commit keeps tests green.

**Tech Stack:** React 19 / Next.js 15.3 App Router (client components), TypeScript 5.8, Vitest + Testing Library, `lucide-react`.

## Global Constraints

- **Markup-preserving only.** The composed DOM output must be byte-for-byte equivalent to today's. No className changes, no element reordering, no new wrappers. Move JSX verbatim.
- **Public surface preserved.** `components/SearchPanel.tsx` must keep exporting `SearchPanel`, `SearchPanelResult`, `SavedSearchRow`, `SearchBookOption`, and `KeywordHighlight` (the last two consumed by tests/`page.tsx`). Use back-compat re-exports.
- **`"use client"` on every interactive module** (`SearchForm`, `SearchResults`, `SavedSearches`, `useSavedSearches`, `highlight.tsx`, the root). Pure data modules (`constants.ts`, `types.ts`, `searchHref.ts`) need no directive.
- **Existing tests are the net.** `tests/unit/components/SearchPanel.test.tsx`, `SearchPanel-highlight.test.tsx`, and `tests/unit/components/a11y-notes-assistant.test.tsx` must pass unchanged. Do not add behavioral tests. The Playwright `npm run test:acceptance` flow is the end-to-end guard (it drives the real `/search` page through search + save) and is required on the final task when the test DB is reachable.
- **Verification gate per task:** `npm run test:unit` AND `npx tsc --noEmit --pretty false` pass before commit; `npm run lint` AND `npm run test:acceptance` (when the test DB is reachable) on the final task.
- **Protected main.** Single PR, `gate` check, feature branch, commit per task.

---

## File Structure

New files under `components/search/`:

| File | Responsibility | Moved from `SearchPanel.tsx` |
| --- | --- | --- |
| `components/search/constants.ts` | Mode list, hints, localStorage key | `MODES`, `MODE_HINTS`, `SHOW_ENGLISH_KEY` (13-39) |
| `components/search/types.ts` | Shared DTOs | `SearchPanelResult` (77-96), `SavedSearchRow` (98-109), `SearchBookOption` (111-114) |
| `components/search/searchHref.ts` | URL builder for pagination & saved-search links | `searchHref` (784-822) |
| `components/search/highlight.tsx` | Presentational highlight + reference link | `ReferenceLink` (716-729), `HighlightedText` (731-749), `KeywordHighlight` (751-782) |
| `components/search/useSavedSearches.ts` | Persistence state + `/api/saved-searches` client | `domainSaveLabel` (41-59) + all saved-search state & mutations (161-166, 175-180, 196-290) |
| `components/search/SearchForm.tsx` | The GET `<form>` + local input state | `<form>` block (302-491) + input state (155-160, 185-194) + `showMorphMatch`/`pageSizeOptions` (296-297) |
| `components/search/SearchResults.tsx` | Results section: header, show-English, save button, articles, empty state, pagination | results `<section>` (493-637) + `showEnglish` state/effect (167, 169-173) + `buildExampleSearches` (61-75) + `previousPage`/`nextPage`/`rangeStart`/`rangeEnd` (292-295) |
| `components/search/SavedSearches.tsx` | Saved-search sidebar `<aside>` | `<aside>` block (640-711) |
| `components/SearchPanel.tsx` | **Composition root** (kept) | grid shell (299-301, 638-639, 712-714) + back-compat re-exports |

**Props/data flow:** `SearchForm` is fully self-contained (GET-submits to `/search`; needs no parent callbacks). `SearchResults` and `SavedSearches` both consume the `useSavedSearches` hook, which the root calls once and threads down. The hook needs the *executed* (URL) values to build the save payload — not the form's live local state.

---

## Task 1: Extract pure modules (constants, types, searchHref, highlight)

**Files:**
- Create: `components/search/constants.ts`, `components/search/types.ts`, `components/search/searchHref.ts`, `components/search/highlight.tsx`
- Modify: `components/SearchPanel.tsx`

**Interfaces:**
- Produces: `MODES`, `MODE_HINTS`, `SHOW_ENGLISH_KEY` (constants); types `SearchPanelResult`, `SavedSearchRow`, `SearchBookOption`; `searchHref(args)`; components `ReferenceLink`, `HighlightedText`, `KeywordHighlight`.
- Consumes: `searchHref` has no deps; `highlight.tsx` consumes `splitWithMatches`/`HighlightSegment` (`@/lib/search-highlight`), `readerHref` (`@/lib/references`), `Link`, `Fragment`.

- [ ] **Step 1: Create `components/search/constants.ts`** — move `SHOW_ENGLISH_KEY` (13), `MODES` (15-20), `MODE_HINTS` (22-39) verbatim, each `export`ed.

- [ ] **Step 2: Create `components/search/types.ts`** — move `SearchPanelResult` (77-96), `SavedSearchRow` (98-109), `SearchBookOption` (111-114) verbatim, each `export`ed. Header: `import type { HighlightSegment } from "@/lib/search-highlight";` (used by `SearchPanelResult`).

- [ ] **Step 3: Create `components/search/searchHref.ts`** — move `searchHref` (784-822) verbatim, `export`ed. No imports needed (uses only `URLSearchParams`).

- [ ] **Step 4: Create `components/search/highlight.tsx`** with `"use client"` and header:
```tsx
"use client";

import Link from "next/link";
import { Fragment } from "react";
import { splitWithMatches, type HighlightSegment } from "@/lib/search-highlight";
import { readerHref } from "@/lib/references";
```
Move `ReferenceLink` (716-729), `HighlightedText` (731-749), `KeywordHighlight` (751-782) verbatim. `ReferenceLink` and `HighlightedText` were file-private — `export` `KeywordHighlight` (public) and export `ReferenceLink`/`HighlightedText` too (SearchResults will import them in Task 5).

- [ ] **Step 5: Update `components/SearchPanel.tsx`** — delete the moved blocks; add imports:
```tsx
import { MODES, MODE_HINTS, SHOW_ENGLISH_KEY } from "@/components/search/constants";
import type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
import { searchHref } from "@/components/search/searchHref";
import { ReferenceLink, HighlightedText, KeywordHighlight } from "@/components/search/highlight";
```
Add back-compat re-exports so existing importers keep working:
```tsx
export type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
export { KeywordHighlight } from "@/components/search/highlight";
```
Remove now-unused imports from the top of `SearchPanel.tsx` (`splitWithMatches`, `HighlightSegment`, `readerHref`, `Fragment` if no longer referenced in-file — they will be, until Task 5 moves the results JSX; keep whatever the remaining in-file JSX still uses and let lint flag leftovers on the final task).

- [ ] **Step 6: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: `SearchPanel.test.tsx`, `SearchPanel-highlight.test.tsx` (imports `KeywordHighlight` from `@/components/SearchPanel`) pass.

- [ ] **Step 7: Commit**
```bash
git add components/search/constants.ts components/search/types.ts components/search/searchHref.ts components/search/highlight.tsx components/SearchPanel.tsx
git commit -m "refactor(search-ui): extract SearchPanel constants/types/searchHref/highlight"
```

---

## Task 2: Extract the `useSavedSearches` hook (persistence + API client)

**Files:**
- Create: `components/search/useSavedSearches.ts`
- Modify: `components/SearchPanel.tsx`

**Interfaces:**
- Produces:
```ts
type SavedSearchExecuted = {
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  domain: string; subdomain: string; ln: string; domainOptions: DomainOptions;
};
function useSavedSearches(initial: SavedSearchRow[], executed: SavedSearchExecuted): {
  saved: SavedSearchRow[];
  saveStatus: string | null;
  saving: boolean;
  saveSearch: () => Promise<void>;
  pending: Record<string, boolean>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  itemStatus: Record<string, string>;
  deleteSavedSearch: (id: string) => Promise<void>;
  renameSavedSearch: (id: string, newLabel: string) => Promise<void>;
};
```
- Consumes: `useState` (react), `DomainOptions` (`@/lib/search`), `useAutoDismissMap`/`useAutoDismissString` (`@/lib/useAutoDismissStatus`), `normalizeSearchMode` (`@/lib/searchMode`), `SavedSearchRow` (`@/components/search/types`).

- [ ] **Step 1: Create `components/search/useSavedSearches.ts`** with `"use client"` and header:
```tsx
"use client";

import { useState } from "react";
import type { DomainOptions } from "@/lib/search";
import { useAutoDismissMap, useAutoDismissString } from "@/lib/useAutoDismissStatus";
import { normalizeSearchMode } from "@/lib/searchMode";
import type { SavedSearchRow } from "@/components/search/types";
```
Then:
1. Move `domainSaveLabel` (41-59) verbatim (file-private to the hook module — no `export`).
2. Add the `SavedSearchExecuted` type (signature above).
3. Write the hook. State declarations move verbatim from `SearchPanel.tsx:161-166` (`saveStatus`, `saving`, `saved`←`initial`, `pending`, `editingId`, `itemStatus`). The two `useAutoDismiss*` calls move from 175-176. `setRowStatus` moves verbatim from 178-180. `saveSearch` (196-244), `deleteSavedSearch` (246-262), `renameSavedSearch` (264-290) move **verbatim** — they already read `mode`/`query`/`book`/`chapter`/`matchMode`/`domain`/`subdomain`/`ln`/`domainOptions`, which now come from the destructured `executed` param:
```tsx
export function useSavedSearches(initial: SavedSearchRow[], executed: SavedSearchExecuted) {
  const { mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions } = executed;
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemStatus, setItemStatus] = useState<Record<string, string>>({});

  useAutoDismissString(saveStatus, setSaveStatus);
  useAutoDismissMap(itemStatus, setItemStatus);

  function setRowStatus(id: string, message: string | null) {
    setItemStatus((current) => ({ ...current, [id]: message ?? "" }));
  }

  // saveSearch, deleteSavedSearch, renameSavedSearch — moved verbatim from
  // SearchPanel.tsx:196-290 (bodies unchanged).

  return {
    saved, saveStatus, saving, saveSearch,
    pending, editingId, setEditingId, itemStatus,
    deleteSavedSearch, renameSavedSearch
  };
}
```
Note: `saveSearch` reads `mode` via `normalizeSearchMode(mode)` (line 197) — `mode` is `executed.mode`; the import of `normalizeSearchMode` is required here.

- [ ] **Step 2: Update `components/SearchPanel.tsx`** — delete the moved state, `domainSaveLabel`, `setRowStatus`, and the three mutation functions. Call the hook inside the component (just below the props destructure):
```tsx
const savedApi = useSavedSearches(savedSearches, {
  mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions
});
```
Replace in-place references in the still-in-file JSX: `saved`→`savedApi.saved`, `saveStatus`→`savedApi.saveStatus`, `saving`→`savedApi.saving`, `saveSearch`→`savedApi.saveSearch`, `pending`→`savedApi.pending`, `editingId`/`setEditingId`→`savedApi.editingId`/`savedApi.setEditingId`, `itemStatus`→`savedApi.itemStatus`, `deleteSavedSearch`→`savedApi.deleteSavedSearch`, `renameSavedSearch`→`savedApi.renameSavedSearch`. Add `import { useSavedSearches } from "@/components/search/useSavedSearches";`. Remove now-unused imports (`useAutoDismissMap`/`useAutoDismissString`, `normalizeSearchMode` if no longer used in-file — `normalizeSearchMode` is still used by the form's `activeMode` init at 155 until Task 4; keep it).

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass — `SearchPanel.test.tsx`'s save/delete/rename assertions still exercise the same logic, now via the hook.

- [ ] **Step 4: Commit**
```bash
git add components/search/useSavedSearches.ts components/SearchPanel.tsx
git commit -m "refactor(search-ui): extract saved-search persistence into useSavedSearches hook"
```

---

## Task 3: Extract `SavedSearches.tsx` (sidebar)

**Files:**
- Create: `components/search/SavedSearches.tsx`
- Modify: `components/SearchPanel.tsx`

**Interfaces:**
- Produces:
```ts
function SavedSearches(props: {
  pageSize: number;
  saved: SavedSearchRow[];
  pending: Record<string, boolean>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  itemStatus: Record<string, string>;
  deleteSavedSearch: (id: string) => Promise<void>;
  renameSavedSearch: (id: string, newLabel: string) => Promise<void>;
}): JSX.Element;
```
- Consumes: `Link`, `Pencil`/`Trash2` (`lucide-react`), `bookName` (`@/lib/references`), `searchHref` (`@/components/search/searchHref`), `SavedSearchRow` (`@/components/search/types`).

- [ ] **Step 1: Create `components/search/SavedSearches.tsx`** with `"use client"` and header:
```tsx
"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { bookName } from "@/lib/references";
import { searchHref } from "@/components/search/searchHref";
import type { SavedSearchRow } from "@/components/search/types";
```
Move the `<aside>` block (640-711) verbatim into the component's `return`, wrapping it in the signature above. The JSX references `saved`, `editingId`, `pending`, `itemStatus`, `setEditingId`, `renameSavedSearch`, `deleteSavedSearch`, `pageSize` — all now props.

- [ ] **Step 2: Update `components/SearchPanel.tsx`** — replace the inline `<aside>...</aside>` with:
```tsx
<SavedSearches
  pageSize={pageSize}
  saved={savedApi.saved}
  pending={savedApi.pending}
  editingId={savedApi.editingId}
  setEditingId={savedApi.setEditingId}
  itemStatus={savedApi.itemStatus}
  deleteSavedSearch={savedApi.deleteSavedSearch}
  renameSavedSearch={savedApi.renameSavedSearch}
/>
```
Add `import { SavedSearches } from "@/components/search/SavedSearches";`. Remove now-unused in-file imports (`Pencil`, `Trash2`, and `bookName` if unused elsewhere in-file).

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass (saved-search list, rename, delete assertions).

- [ ] **Step 4: Commit**
```bash
git add components/search/SavedSearches.tsx components/SearchPanel.tsx
git commit -m "refactor(search-ui): extract SavedSearches sidebar component"
```

---

## Task 4: Extract `SearchForm.tsx` (form + local input state)

**Files:**
- Create: `components/search/SearchForm.tsx`
- Modify: `components/SearchPanel.tsx`

**Interfaces:**
- Produces:
```ts
function SearchForm(props: {
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  domain: string; subdomain: string; ln: string;
  books: SearchBookOption[]; domainOptions: DomainOptions; pageSize: number;
}): JSX.Element;
```
- Consumes: `Search`/`X` (`lucide-react`), `useState` (react), `MODES`/`MODE_HINTS` (`@/components/search/constants`), `normalizeSearchMode` (`@/lib/searchMode`), `DomainOptions` (`@/lib/search`), `SearchBookOption` (`@/components/search/types`).

- [ ] **Step 1: Create `components/search/SearchForm.tsx`** with `"use client"` and header:
```tsx
"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { MODES, MODE_HINTS } from "@/components/search/constants";
import { normalizeSearchMode } from "@/lib/searchMode";
import type { DomainOptions } from "@/lib/search";
import type { SearchBookOption } from "@/components/search/types";
```
Inside `SearchForm`, move verbatim from `SearchPanel.tsx`: the input state declarations (155-160 — `activeMode`, `queryValue`, `selectedBook`, `selectedDomain`, `selectedSubdomain`, `lnValue`), `onDomainChange`/`onSubdomainChange` (185-194), and `showMorphMatch`/`pageSizeOptions` (296-297). Then move the entire `<form>...</form>` block (302-491) verbatim as the `return`. The form's `defaultValue={chapter}`, `value={queryValue}`, `value={selectedBook}`, etc. all resolve to props/local state present here.

- [ ] **Step 2: Update `components/SearchPanel.tsx`** — replace the inline `<form>...</form>` with:
```tsx
<SearchForm
  mode={mode}
  query={query}
  book={book}
  chapter={chapter}
  matchMode={matchMode}
  domain={domain}
  subdomain={subdomain}
  ln={ln}
  books={books}
  domainOptions={domainOptions}
  pageSize={pageSize}
/>
```
Add `import { SearchForm } from "@/components/search/SearchForm";`. Remove now-unused in-file imports/state: `normalizeSearchMode` (form owned it via `activeMode`), `Search`/`X`, and the `activeMode`/`queryValue`/etc. `useState` lines, `onDomainChange`/`onSubdomainChange`, `showMorphMatch`/`pageSizeOptions`. Note `MODES`/`MODE_HINTS` are no longer used by the root after the results block also leaves (Task 5) — keep until then if any in-file JSX still references them (the results empty-state uses neither; safe to drop now if unused).

- [ ] **Step 3: Verify**
```bash
npm run test:unit
npx tsc --noEmit --pretty false
```
Expected: pass — mode switching, query clear button, domain selectors, page-size auto-submit all behave identically.

- [ ] **Step 4: Commit**
```bash
git add components/search/SearchForm.tsx components/SearchPanel.tsx
git commit -m "refactor(search-ui): extract SearchForm with its local input state"
```

---

## Task 5: Extract `SearchResults.tsx` and reduce `SearchPanel.tsx` to a composition root

**Files:**
- Create: `components/search/SearchResults.tsx`
- Modify: `components/SearchPanel.tsx`

**Interfaces:**
- Produces:
```ts
function SearchResults(props: {
  results: SearchPanelResult[]; hasSearch: boolean; count: number;
  page: number; pageCount: number; pageSize: number; searchLabel: string;
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  domain: string; subdomain: string; ln: string; domainOptions: DomainOptions;
  saveSearch: () => Promise<void>; saving: boolean; saveStatus: string | null;
}): JSX.Element;
```
- Consumes: `Link`, `BookmarkPlus` (`lucide-react` — the only icon used here; `Search`/`X` belong to `SearchForm`), `useEffect`/`useState` (react), `decodeMorphCode` (`@/lib/morphology`), `SHOW_ENGLISH_KEY` (`@/components/search/constants`), `searchHref` (`@/components/search/searchHref`), `ReferenceLink`/`HighlightedText`/`KeywordHighlight` (`@/components/search/highlight`), `SearchPanelResult` (`@/components/search/types`), `DomainOptions` (`@/lib/search`).

- [ ] **Step 1: Create `components/search/SearchResults.tsx`** with `"use client"` and header:
```tsx
"use client";

import Link from "next/link";
import { BookmarkPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { decodeMorphCode } from "@/lib/morphology";
import { SHOW_ENGLISH_KEY } from "@/components/search/constants";
import { searchHref } from "@/components/search/searchHref";
import { ReferenceLink, HighlightedText, KeywordHighlight } from "@/components/search/highlight";
import type { SearchPanelResult } from "@/components/search/types";
import type { DomainOptions } from "@/lib/search";
```
The icon set is exactly `BookmarkPlus` (the Save-search button at original line 522); the `Search`/`X` icons live in `SearchForm`, not here, so they are deliberately not imported (importing them would fail `eslint --max-warnings=0`). The highlight import includes **all three** of `ReferenceLink`, `HighlightedText`, and `KeywordHighlight` because the token-result branch renders `<HighlightedText text={result.verseText} match={result.surface} />` directly (original line 570), separate from `KeywordHighlight`.

Inside `SearchResults`:
1. Move `buildExampleSearches` (61-75) verbatim above the component (module-private; it takes `domainOptions`).
2. Move `showEnglish` state (167) + the `useEffect` localStorage read (169-173) verbatim.
3. Move `previousPage`/`nextPage`/`rangeStart`/`rangeEnd` (292-295) verbatim.
4. Move the results `<section>...</section>` block (493-637) verbatim as the `return`. It references `hasSearch`, `count`, `searchLabel`, `page`, `pageCount`, `showEnglish`, `query`, `mode`, `domain`, `subdomain`, `ln`, `saveSearch`, `saving`, `saveStatus`, `results`, `pageSize`, `book`, `chapter`, `matchMode`, `domainOptions` (via `buildExampleSearches`) — all props or local. The save-button block (514-526) and its `onClick={saveSearch}` stay intact.

- [ ] **Step 2: Reduce `components/SearchPanel.tsx` to the composition root.** Final file:
```tsx
"use client";

import { useSavedSearches } from "@/components/search/useSavedSearches";
import { SearchForm } from "@/components/search/SearchForm";
import { SearchResults } from "@/components/search/SearchResults";
import { SavedSearches } from "@/components/search/SavedSearches";
import type { DomainOptions } from "@/lib/search";
import type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";

export type { SearchPanelResult, SavedSearchRow, SearchBookOption } from "@/components/search/types";
export { KeywordHighlight } from "@/components/search/highlight";

export function SearchPanel({
  mode, query, book, chapter, matchMode, page, pageSize, count, pageCount,
  results, books, savedSearches, domain, subdomain, ln, domainOptions,
  hasSearch, searchLabel
}: {
  mode: string; query: string; book: string; chapter: string; matchMode: string;
  page: number; pageSize: number; count: number; pageCount: number;
  results: SearchPanelResult[]; books: SearchBookOption[]; savedSearches: SavedSearchRow[];
  domain: string; subdomain: string; ln: string; domainOptions: DomainOptions;
  hasSearch: boolean; searchLabel: string;
}) {
  const savedApi = useSavedSearches(savedSearches, {
    mode, query, book, chapter, matchMode, domain, subdomain, ln, domainOptions
  });

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-6">
        <SearchForm
          mode={mode} query={query} book={book} chapter={chapter} matchMode={matchMode}
          domain={domain} subdomain={subdomain} ln={ln}
          books={books} domainOptions={domainOptions} pageSize={pageSize}
        />
        <SearchResults
          results={results} hasSearch={hasSearch} count={count} page={page}
          pageCount={pageCount} pageSize={pageSize} searchLabel={searchLabel}
          mode={mode} query={query} book={book} chapter={chapter} matchMode={matchMode}
          domain={domain} subdomain={subdomain} ln={ln} domainOptions={domainOptions}
          saveSearch={savedApi.saveSearch} saving={savedApi.saving} saveStatus={savedApi.saveStatus}
        />
      </div>
      <SavedSearches
        pageSize={pageSize}
        saved={savedApi.saved} pending={savedApi.pending}
        editingId={savedApi.editingId} setEditingId={savedApi.setEditingId}
        itemStatus={savedApi.itemStatus}
        deleteSavedSearch={savedApi.deleteSavedSearch}
        renameSavedSearch={savedApi.renameSavedSearch}
      />
    </div>
  );
}
```
Confirm the outer grid + left `space-y-6` wrapper + right column match the original (299-301 / 638 / 712-714).

- [ ] **Step 3: Verify (full gate)**
```bash
npm run lint
npx tsc --noEmit --pretty false
npm run test:unit
```
Expected: lint clean (no leftover unused imports across the new files or the root), no type errors, all component tests pass.

- [ ] **Step 4: Run the acceptance suite — required when the test DB is reachable.** `scripts/acceptance-test.js:208-218` is a real Playwright run that opens `/search`, asserts the λόγος results render, clicks **Save search**, and verifies it appears in the saved-search sidebar — i.e. it exercises the exact `SearchForm`/`SearchResults`/`SavedSearches`/`useSavedSearches` surface this plan splits, end-to-end through the actual page:
```bash
npm run test:acceptance
```
Expected: pass **unchanged** — this split is markup-preserving, so the script needs no edits (per the `acceptance-needs-full-corpus` memory, only retrieval/search *behavior* changes touch that file). Only if the DB/corpus is genuinely unreachable (preflight fails) may you defer to the PR `gate` check, stating in the PR that acceptance was not run locally and why. This is the authoritative end-to-end guard; the unit suite remains the per-task net.

- [ ] **Step 5: Check the project docs** — `CLAUDE.md` requires checking both `README.md` and `docs/PROJECT_STATE.md` after major changes. This component split touches no public API the README architecture table names (it lists `app/search`, not `components/*`), so README is expected to need no edit — confirm that. Read `docs/PROJECT_STATE.md` and edit it **only if** it references the old single-file `components/SearchPanel.tsx` structure in a way the split makes stale; otherwise state "no change needed." `git add` it only if edited.

- [ ] **Step 6: Commit**
```bash
git add components/search/SearchResults.tsx components/SearchPanel.tsx
git commit -m "refactor(search-ui): extract SearchResults; reduce SearchPanel to a composition root"
```

---

## Self-Review

- **Spec coverage:** Codex P1 #2 ("split into form, result list, saved-search sidebar, and saved-search hook/API client") — `SearchForm` (Task 4), `SearchResults`/result list (Task 5), `SavedSearches` sidebar (Task 3), `useSavedSearches` hook/API client (Task 2). The pure-helper extraction (Task 1) is additive scaffolding that keeps later moves mechanical. ✅
- **Placeholder scan:** every move cites exact line ranges + the destination header; the root and hook are shown in full; no TBD/"handle later". ✅
- **Type/name consistency:** `useSavedSearches` returns exactly the fields consumed by `SearchResults` (`saveSearch`/`saving`/`saveStatus`) and `SavedSearches` (`saved`/`pending`/`editingId`/`setEditingId`/`itemStatus`/`deleteSavedSearch`/`renameSavedSearch`); the root's prop wiring matches both component signatures; `SearchBookOption`/`SearchPanelResult`/`SavedSearchRow` are defined once in `types.ts` and imported everywhere. ✅
- **Risk:** the executed-vs-local-state distinction is the one subtlety — the form keeps live input state; pagination links and the save payload use the *props* (URL state). This matches today's behavior (e.g. `saveSearch` already reads `query`, not `queryValue`). The existing `SearchPanel.test.tsx` guards it per task, and the `test:acceptance` search-and-save flow (Task 5 Step 4) confirms it end-to-end.

## Execution Handoff

See the roadmap note in the chat response. **Land the search-service split (`2026-06-24-search-service-split.md`) first** — both touch the search surface, but the service split changes no UI and de-risks the import graph the UI relies on.
