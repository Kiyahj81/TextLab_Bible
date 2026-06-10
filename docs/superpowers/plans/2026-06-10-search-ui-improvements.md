# Search Page UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 2026-06-10 search-page UI review findings in three phases: high-impact UX (reader links, stale-state fix, segmented mode control, example chips, copy fixes), medium refinements (labels, morph tooltips, saved-search polish, pagination/filter ergonomics), and a combined accessibility + visual-polish pass.

**Architecture:** All changes are confined to the `/search` surface — [app/search/page.tsx](../../app/search/page.tsx) (server component), [components/SearchPanel.tsx](../../components/SearchPanel.tsx) (client component), plus three new small pure-helper modules in `lib/` (`readerHref` added to `lib/references.ts`, new `lib/searchStateKey.ts`, `lib/searchLabel.ts`, `lib/morphology.ts`). No schema, API, or retrieval changes — the eval gate is unaffected. Each phase is its own branch + PR (main is ruleset-protected: PR required, `gate` check must pass).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.8, Tailwind (accent palette 50–900 from `#365f7e`), Vitest 4 + @testing-library/react 16 + jsdom, Playwright acceptance script.

---

## Context an implementer must know

- **Search results carry only a formatted `reference` string** (`"John 1:14"`, `"1Cor 13:13"`), built by `formatReference(osisId, chapter, verse)` in [lib/references.ts:1](../../lib/references.ts#L1). `parseReference` (same file) parses these back (book aliases include lowercase osis ids like `1cor`).
- **The reader URL contract** ([app/read/page.tsx:22-24](../../app/read/page.tsx#L22-L24)): `/read?book=<osisId>&chapter=<n>&verse=<n>`. The `verse` param scrolls the verse into view.
- **morphCode stored format** ([scripts/import-open-bible.ts:597](../../scripts/import-open-bible.ts#L597)): `partOfSpeech` (2 chars, e.g. `N-`, `RA`) + MorphGNT 8-column parsing code with *leading* dashes stripped, then *trailing* dashes stripped from the whole. Real examples: `N-NSM` (noun), `RANSM` (article), `V-3PAI-S` (finite verb), `V-PAPNSM` (participle), `V-PAN` (infinitive), `C` (conjunction — the trailing-dash strip eats the `-` of `C-`).
- **Stale-state bug class:** `SearchPanel` seeds `useState` from server props ([components/SearchPanel.tsx:81-85](../../components/SearchPanel.tsx#L81-L85)). Client-side navigation to `/search?...` re-renders the server page but does **not** remount the client component, so the form shows stale mode/query after clicking a saved search. PR 16 fixed the same class of bug in `ReaderControls`. Fix here: a `key` on `<SearchPanel>` derived from the URL-driven state.
- **Acceptance script couplings** ([scripts/acceptance-test.js:187-196](../../scripts/acceptance-test.js#L187-L196)): waits for `'40 results for "λόγος"'` (Playwright `getByText` = substring match), `"John 1:1"`, button `"Save search"`, text `"Search saved."`, link `/lemma: λόγος/`. **Phase 2 Task 2.1 changes the results label and MUST update this script.** `npm run verify` does NOT run acceptance; it needs `npm run test:acceptance` against the `.env.test` Neon branch.
- **Test conventions:** see [tests/unit/components/AiAssistant-grounding.test.tsx](../../tests/unit/components/AiAssistant-grounding.test.tsx) — `// @vitest-environment jsdom` pragma, `render/screen/fireEvent/cleanup` from RTL, `vi.stubGlobal("fetch", ...)`, `afterEach(cleanup)`. No jest-dom matchers — use `.toBeTruthy()` / property checks.
- **Run a single test file:** `npx vitest run tests/unit/lib/references.test.ts`. Full check: `npm run verify` (lint + tsc + build + coverage).
- **Commit style:** plain imperative subject (repo convention), end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. On Windows PowerShell prefer `git commit -F <file>` or multiple `-m` flags — never here-strings through the Bash tool.

## File structure

| File | Role |
|---|---|
| `lib/references.ts` (modify) | add `readerHref(reference)` — reference string → reader URL |
| `lib/searchStateKey.ts` (create) | pure key builder for the `<SearchPanel>` remount fix |
| `lib/searchLabel.ts` (create) | pure results-label builders (`querySearchLabel`, `scopeSuffix`) |
| `lib/morphology.ts` (create) | `decodeMorphCode` — stored morph code → human-readable parsing |
| `components/SearchPanel.tsx` (modify) | all client-side UI changes |
| `app/search/page.tsx` (modify) | remount key, results label |
| `scripts/acceptance-test.js` (modify, Phase 2) | update results-label assertion |
| `tests/unit/lib/references.test.ts` (modify) | `readerHref` tests |
| `tests/unit/lib/searchStateKey.test.ts` (create) | key-builder tests |
| `tests/unit/lib/searchLabel.test.ts` (create) | label-builder tests |
| `tests/unit/lib/morphology.test.ts` (create) | decoder tests |
| `tests/unit/components/SearchPanel.test.tsx` (create) | RTL tests for all SearchPanel behavior added by this plan |
| `README.md`, `docs/PROJECT_STATE.md` (modify, Phase 3 end) | doc refresh per CLAUDE.md |

---

# Phase 1 — High impact

Branch: `feat/search-ui-phase1` (from up-to-date `main`).

### Task 1.0: Branch setup

- [ ] **Step 1: Create the branch**

```powershell
git checkout main; git pull; git checkout -b feat/search-ui-phase1
```

### Task 1.1: Link result references into the reader

**Files:**
- Modify: `lib/references.ts` (append after `parseReference`)
- Modify: `components/SearchPanel.tsx:382`
- Test: `tests/unit/lib/references.test.ts`, create `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing helper tests**

Append to `tests/unit/lib/references.test.ts` (add `readerHref` to the existing import from `@/lib/references`):

```ts
describe("readerHref", () => {
  it("builds a reader URL from a formatted reference", () => {
    expect(readerHref("John 1:14")).toBe("/read?book=John&chapter=1&verse=14");
  });

  it("handles numbered books", () => {
    expect(readerHref("1Cor 13:13")).toBe("/read?book=1Cor&chapter=13&verse=13");
  });

  it("returns null for unparseable references", () => {
    expect(readerHref("not a reference")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/references.test.ts`
Expected: FAIL — `readerHref` is not exported.

- [ ] **Step 3: Implement `readerHref`**

Append to `lib/references.ts`:

```ts
export function readerHref(reference: string): string | null {
  const parsed = parseReference(reference);
  if (!parsed) return null;
  return `/read?book=${encodeURIComponent(parsed.book)}&chapter=${parsed.chapter}&verse=${parsed.verse}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/references.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Create `tests/unit/components/SearchPanel.test.tsx`. This file's module-level fixtures (`domainOptions`, `baseProps`, `tokenResult`) are shared by every SearchPanel test added in later tasks:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchPanel, SearchPanelResult } from "@/components/SearchPanel";
import type { DomainOptions } from "@/lib/search";

const domainOptions: DomainOptions = {
  domains: [{ code: "025", number: 25, label: "Attitudes and Emotions" }],
  subdomainsByDomain: { "025": [{ code: "025001", label: "Attitude, Disposition" }] }
};

const baseProps = {
  mode: "keyword",
  query: "",
  book: "",
  chapter: "",
  matchMode: "exact",
  page: 1,
  pageSize: 25,
  count: 0,
  pageCount: 0,
  results: [] as SearchPanelResult[],
  books: [
    { osisId: "John", label: "John" },
    { osisId: "1Cor", label: "1 Corinthians" }
  ],
  savedSearches: [],
  domain: "",
  subdomain: "",
  ln: "",
  domainOptions,
  hasSearch: false,
  searchLabel: ""
};

const tokenResult: SearchPanelResult = {
  kind: "token",
  corpus: "SBLGNT",
  reference: "John 1:1",
  surface: "λόγος",
  lemma: "λόγος",
  morphCode: "N-NSM",
  verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος"
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchPanel result references", () => {
  it("links each result reference to the reader", () => {
    render(
      <SearchPanel
        {...baseProps}
        hasSearch={true}
        searchLabel='"λόγος"'
        count={1}
        pageCount={1}
        results={[tokenResult]}
      />
    );
    const link = screen.getByRole("link", { name: /John 1:1/ });
    expect(link.getAttribute("href")).toBe("/read?book=John&chapter=1&verse=1");
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — no link role found (reference is a plain span).

- [ ] **Step 7: Render references as reader links**

In `components/SearchPanel.tsx`, add to the imports:

```tsx
import { readerHref } from "@/lib/references";
```

Replace (line ~382):

```tsx
<span className="oldstyle-nums font-display text-base font-semibold text-slate-900">{result.reference}</span>
```

with:

```tsx
<ReferenceLink reference={result.reference} />
```

and add this component next to `HighlightedText` at the bottom of the file:

```tsx
function ReferenceLink({ reference }: { reference: string }) {
  const className = "oldstyle-nums font-display text-base font-semibold text-slate-900";
  const href = readerHref(reference);
  if (!href) return <span className={className}>{reference}</span>;
  return (
    <Link
      href={href}
      title="Open in reader"
      className={`${className} underline-offset-4 transition-colors hover:text-accent-700 hover:underline`}
    >
      {reference}
    </Link>
  );
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add lib/references.ts components/SearchPanel.tsx tests/unit/lib/references.test.ts tests/unit/components/SearchPanel.test.tsx
git commit -m "Link search result references into the reader" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1.2: Fix stale client state via a remount key

**Files:**
- Create: `lib/searchStateKey.ts`
- Modify: `app/search/page.tsx:107`
- Test: create `tests/unit/lib/searchStateKey.test.ts`, append to `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing helper test**

Create `tests/unit/lib/searchStateKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { searchStateKey } from "@/lib/searchStateKey";

const base = {
  mode: "keyword",
  query: "light",
  book: "",
  chapter: "",
  matchMode: "exact",
  domain: "",
  subdomain: "",
  ln: ""
};

describe("searchStateKey", () => {
  it("is stable for identical params", () => {
    expect(searchStateKey({ ...base })).toBe(searchStateKey({ ...base }));
  });

  it("changes when any param changes", () => {
    expect(searchStateKey({ ...base, mode: "lemma" })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, ln: "33.55" })).not.toBe(searchStateKey(base));
    expect(searchStateKey({ ...base, book: "John" })).not.toBe(searchStateKey(base));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/searchStateKey.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `lib/searchStateKey.ts`:

```ts
// Key for <SearchPanel> so it remounts whenever URL-driven search state changes.
// SearchPanel seeds useState from server props; without a remount, client-side
// navigation (e.g. clicking a saved search) leaves the form showing stale
// mode/query — the same bug class PR 16 fixed in ReaderControls.
export function searchStateKey(params: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain: string;
  subdomain: string;
  ln: string;
}): string {
  return [
    params.mode,
    params.query,
    params.book,
    params.chapter,
    params.matchMode,
    params.domain,
    params.subdomain,
    params.ln
  ].join("|");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/searchStateKey.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the regression test for remount behavior**

Append to `tests/unit/components/SearchPanel.test.tsx`:

```tsx
describe("SearchPanel remount key", () => {
  it("resets client form state when the key changes", () => {
    const { rerender } = render(<SearchPanel key="a" {...baseProps} mode="keyword" />);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "lemma" } });
    expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("lemma");

    // New props + new key (as page.tsx now supplies) → fresh state.
    rerender(<SearchPanel key="b" {...baseProps} mode="domain" />);
    expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("domain");
  });
});
```

Note: this test targets the current mode `<select>`; Task 1.3 rewrites it for the segmented control.

- [ ] **Step 6: Run to verify pass** (the key mechanism is React-native; this documents it)

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire the key in the page**

In `app/search/page.tsx`, add the import:

```tsx
import { searchStateKey } from "@/lib/searchStateKey";
```

and change the `<SearchPanel` opening tag to:

```tsx
<SearchPanel
  key={searchStateKey({ mode, query, book, chapter, matchMode, domain, subdomain, ln })}
  mode={mode}
```

- [ ] **Step 8: Manual verification of the original bug-fix**

Run `npm run dev`, sign in, run a keyword search, save it, switch the form to Lemma mode without searching, then click the saved search in the sidebar. The form must snap back to Keyword with the saved query shown.

- [ ] **Step 9: Commit**

```powershell
git add lib/searchStateKey.ts app/search/page.tsx tests/unit/lib/searchStateKey.test.ts tests/unit/components/SearchPanel.test.tsx
git commit -m "Remount SearchPanel on URL state change to fix stale form controls" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1.3: Segmented mode control with per-mode placeholder and hint

**Files:**
- Modify: `components/SearchPanel.tsx:204-306` (mode select + query row)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/components/SearchPanel.test.tsx`:

```tsx
describe("SearchPanel mode control", () => {
  it("renders the four modes as a radio group", () => {
    render(<SearchPanel {...baseProps} />);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect((screen.getByRole("radio", { name: "Keyword" }) as HTMLInputElement).checked).toBe(true);
  });

  it("switches placeholder and hint with the selected mode", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    expect(screen.getByPlaceholderText(/λόγος, ἀγάπη/)).toBeTruthy();
    expect(screen.getByText(/inflected form/i)).toBeTruthy();
  });

  it("shows domain filters when Domain mode is selected", () => {
    render(<SearchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    expect(screen.getByRole("combobox", { name: "Domain" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Subdomain" })).toBeTruthy();
  });
});
```

Also rewrite Task 1.2's remount test (the `<select>` is going away):

```tsx
describe("SearchPanel remount key", () => {
  it("resets client form state when the key changes", () => {
    const { rerender } = render(<SearchPanel key="a" {...baseProps} mode="keyword" />);
    fireEvent.click(screen.getByRole("radio", { name: "Lemma" }));
    expect((screen.getByRole("radio", { name: "Lemma" }) as HTMLInputElement).checked).toBe(true);

    rerender(<SearchPanel key="b" {...baseProps} mode="domain" />);
    expect((screen.getByRole("radio", { name: "Domain" }) as HTMLInputElement).checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — no radio roles.

- [ ] **Step 3: Implement the segmented control**

In `components/SearchPanel.tsx`, add module-level constants above the component:

```tsx
const MODES = [
  { value: "keyword", label: "Keyword" },
  { value: "lemma", label: "Lemma" },
  { value: "morphology", label: "Morphology" },
  { value: "domain", label: "Domain" }
] as const;

const MODE_HINTS: Record<string, { placeholder: string; hint: string }> = {
  keyword: {
    placeholder: 'e.g. righteousness, "born again"',
    hint: "Searches verse text in every corpus. Use quotes for exact phrases and a leading - to exclude a word."
  },
  lemma: {
    placeholder: "e.g. λόγος, ἀγάπη, πίστις",
    hint: "Finds every inflected form of a Greek dictionary headword (case-insensitive)."
  },
  morphology: {
    placeholder: "e.g. N-NSM, V-3PAI-S",
    hint: "MorphGNT parsing codes. Switch Morph match to Prefix to broaden (e.g. V-3PAI)."
  },
  domain: {
    placeholder: "e.g. 33.55",
    hint: "Louw–Nida semantic domains. Pick a domain, narrow by subdomain, or enter an exact LN reference."
  }
};
```

Replace the whole first form row — the `div.grid.gap-3.md:grid-cols-[180px_1fr]` containing the Mode `<select>` and the conditional Query/Domain block (currently lines ~204-306) — with:

```tsx
<fieldset>
  <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</legend>
  <div className="mt-1 inline-flex flex-wrap rounded-md border border-stone-300 bg-stone-100 p-0.5">
    {MODES.map((m) => (
      <label
        key={m.value}
        className={`cursor-pointer rounded px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-accent-400 ${
          activeMode === m.value ? "bg-accent-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-950"
        }`}
      >
        <input
          type="radio"
          name="mode"
          value={m.value}
          checked={activeMode === m.value}
          onChange={() => setActiveMode(m.value)}
          className="sr-only"
        />
        {m.label}
      </label>
    ))}
  </div>
</fieldset>
{activeMode === "domain" ? (
  <div className="grid gap-3 sm:grid-cols-3">
    {/* keep the existing three Domain / Subdomain / LN reference labels verbatim,
        except: change the LN input placeholder to MODE_HINTS.domain.placeholder */}
  </div>
) : (
  <label className="block space-y-1">
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Query</span>
    <div className="relative">
      {/* keep the existing query <input> + clear/search buttons verbatim,
          except: placeholder={MODE_HINTS[activeMode]?.placeholder ?? MODE_HINTS.keyword.placeholder} */}
    </div>
  </label>
)}
<p className="text-xs text-slate-500">{(MODE_HINTS[activeMode] ?? MODE_HINTS.keyword).hint}</p>
```

The existing domain-grid and query-input internals move unchanged; only the wrapper grid, the `<select>`, and the two placeholders change. The radio group still submits `mode` with the form GET exactly as the select did.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Visual check**

`npm run dev` → `/search`: four segments render in one pill row; arrow keys move between modes when one is focused; the hint line updates per mode; Domain mode still shows the three dropdown/input fields.

- [ ] **Step 6: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Replace search mode select with segmented control and per-mode hints" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1.4: Empty-state example chips

**Files:**
- Modify: `components/SearchPanel.tsx` (Results section, `!hasSearch` branch)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("SearchPanel empty state", () => {
  it("shows example search chips before any search", () => {
    render(<SearchPanel {...baseProps} />);
    expect(screen.getByRole("link", { name: "Lemma: λόγος" }).getAttribute("href")).toBe(
      `/search?mode=lemma&q=${encodeURIComponent("λόγος")}`
    );
    expect(screen.getByRole("link", { name: "Domain 25: Attitudes and Emotions" }).getAttribute("href")).toBe(
      "/search?mode=domain&domain=025"
    );
  });

  it("hides example chips once a search has run", () => {
    render(<SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' />);
    expect(screen.queryByText("Try an example:")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — links not found.

- [ ] **Step 3: Implement the chips**

In `components/SearchPanel.tsx`, add above the component:

```tsx
function buildExampleSearches(domainOptions: DomainOptions): { label: string; href: string }[] {
  const examples = [
    { label: "Lemma: λόγος", href: `/search?mode=lemma&q=${encodeURIComponent("λόγος")}` },
    { label: 'Keyword: "born again"', href: `/search?mode=keyword&q=${encodeURIComponent('"born again"')}` },
    { label: "Morphology: N-NSM", href: "/search?mode=morphology&q=N-NSM&matchMode=exact" }
  ];
  const domain = domainOptions.domains.find((d) => d.number === 25) ?? domainOptions.domains[0];
  if (domain) {
    examples.push({
      label: `Domain ${domain.number}: ${domain.label}`,
      href: `/search?mode=domain&domain=${encodeURIComponent(domain.code)}`
    });
  }
  return examples;
}
```

Change the results-header subtitle else-branch from `"Enter a search query."` to `"Search the corpus by keyword, lemma, morphology, or semantic domain."`, and inside the results body `<div className="divide-y divide-stone-200">`, add as the first child:

```tsx
{!hasSearch ? (
  <div className="p-4">
    <p className="text-sm text-slate-600">Try an example:</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {buildExampleSearches(domainOptions).map((example) => (
        <Link
          key={example.label}
          href={example.href}
          className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-accent-600 hover:text-accent-700"
        >
          {example.label}
        </Link>
      ))}
    </div>
  </div>
) : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Add example search chips to the search empty state" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1.5: Fix stale no-results copy and add recovery guidance

**Files:**
- Modify: `components/SearchPanel.tsx:405-407`
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel no-results state", () => {
  it("shows recovery guidance instead of sample-data copy", () => {
    render(<SearchPanel {...baseProps} hasSearch={true} searchLabel='"zzz"' results={[]} />);
    expect(screen.getByText(/No results for/)).toBeTruthy();
    expect(screen.getByText(/broader term/)).toBeTruthy();
    expect(screen.queryByText(/sample-data/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Replace the copy**

Replace:

```tsx
{hasSearch && results.length === 0 ? (
  <div className="p-4 text-sm text-slate-600">No matching sample-data results.</div>
) : null}
```

with:

```tsx
{hasSearch && results.length === 0 ? (
  <div className="p-4 text-sm">
    <p className="text-slate-700">No results for {searchLabel}.</p>
    <p className="mt-1 text-slate-500">
      {mode === "morphology"
        ? "Try switching Morph match to Prefix, or remove the book and chapter filters."
        : "Check the spelling, try a broader term, or remove the book and chapter filters."}
    </p>
  </div>
) : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Replace stale sample-data empty copy with recovery guidance" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1.6: Phase 1 verification and PR

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: lint, tsc, build, coverage all pass (coverage thresholds 80/80/75/65 — the new `lib/` helpers are fully unit-tested, so coverage should not regress).

- [ ] **Step 2: Acceptance**

Run: `npm run test:acceptance` (uses `.env.test` Neon branch).
Expected: PASS — Phase 1 does not touch the strings the script asserts (`'40 results for "λόγος"'`, `"Save search"`, `"Search saved."`).

- [ ] **Step 3: Push and open PR**

```powershell
git push -u origin feat/search-ui-phase1
gh pr create --title "Search UI phase 1: reader links, remount fix, segmented modes, empty state" --body "Implements Phase 1 (high-impact) of docs/superpowers/plans/2026-06-10-search-ui-improvements.md: result references link into the reader, SearchPanel remounts on URL state change (stale-form fix, same class as PR 16's ReaderControls fix), segmented mode control with per-mode placeholders/hints, example-search empty state, and corrected no-results copy."
```

- [ ] **Step 4: Review automated PR comments before merging** (project rule — Codex bot has caught P1s before). Merge when `gate` is green.

---

# Phase 2 — Medium refinements

Branch: `feat/search-ui-phase2` (from `main` after Phase 1 merges).

### Task 2.0: Branch setup

- [ ] **Step 1:**

```powershell
git checkout main; git pull; git checkout -b feat/search-ui-phase2
```

### Task 2.1: Include mode and scope in the results label (+ acceptance update)

**Files:**
- Create: `lib/searchLabel.ts`
- Modify: `app/search/page.tsx:54-85, 143-156`
- Modify: `scripts/acceptance-test.js:190`
- Test: create `tests/unit/lib/searchLabel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/searchLabel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { querySearchLabel, scopeSuffix } from "@/lib/searchLabel";

describe("scopeSuffix", () => {
  it("is empty without a book", () => {
    expect(scopeSuffix("")).toBe("");
  });

  it("names the book and optional chapter", () => {
    expect(scopeSuffix("1Cor")).toBe(" in 1 Corinthians");
    expect(scopeSuffix("John", 1)).toBe(" in John 1");
  });
});

describe("querySearchLabel", () => {
  it("includes the mode, query, and scope", () => {
    expect(querySearchLabel("lemma", "λόγος", "John")).toBe('lemma "λόγος" in John');
    expect(querySearchLabel("keyword", "light", "")).toBe('keyword "light"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/searchLabel.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/searchLabel.ts`:

```ts
import { bookName } from "@/lib/references";

export function scopeSuffix(book: string, chapter?: number): string {
  if (!book) return "";
  return ` in ${bookName(book)}${chapter ? ` ${chapter}` : ""}`;
}

export function querySearchLabel(mode: string, query: string, book: string, chapter?: number): string {
  return `${mode} "${query}"${scopeSuffix(book, chapter)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/searchLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the page**

In `app/search/page.tsx` add the import:

```tsx
import { querySearchLabel, scopeSuffix } from "@/lib/searchLabel";
```

In the domain branch, change:

```ts
searchLabel = domainSearchLabel(search.filter, domainOptions);
```

to:

```ts
searchLabel = domainSearchLabel(search.filter, domainOptions) + scopeSuffix(book, parsedChapter);
```

In the query branch, change:

```ts
searchLabel = `"${query}"`;
```

to:

```ts
searchLabel = querySearchLabel(mode, query, book, parsedChapter);
```

- [ ] **Step 6: Update the acceptance assertion**

In `scripts/acceptance-test.js` line 190, the popover's lemma link carries `&book=John`, so the header becomes `40 results for lemma "λόγος" in John, …`. Change:

```js
await page.getByText('40 results for "λόγος"').waitFor();
```

to:

```js
await page.getByText('40 results for lemma "λόγος" in John').waitFor();
```

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/unit` then `npm run test:acceptance`
Expected: both PASS.

- [ ] **Step 8: Commit**

```powershell
git add lib/searchLabel.ts app/search/page.tsx scripts/acceptance-test.js tests/unit/lib/searchLabel.test.ts
git commit -m "Include mode and book scope in search results label" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.2: Human-readable morphology tooltips

**Files:**
- Create: `lib/morphology.ts`
- Modify: `components/SearchPanel.tsx` (morph badge, ~line 385)
- Test: create `tests/unit/lib/morphology.test.ts`, append to `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing decoder tests**

Create `tests/unit/lib/morphology.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeMorphCode } from "@/lib/morphology";

describe("decodeMorphCode", () => {
  it("decodes nominals", () => {
    expect(decodeMorphCode("N-NSM")).toBe("noun — nominative singular masculine");
    expect(decodeMorphCode("RANSM")).toBe("article — nominative singular masculine");
    expect(decodeMorphCode("A-NSMC")).toBe("adjective — nominative singular masculine, comparative");
  });

  it("decodes verbs", () => {
    expect(decodeMorphCode("V-3PAI-S")).toBe("verb — present active indicative, 3rd person singular");
    expect(decodeMorphCode("V-PAPNSM")).toBe("verb — present active participle, nominative singular masculine");
    expect(decodeMorphCode("V-PAN")).toBe("verb — present active infinitive");
  });

  it("handles indeclinables whose trailing dash was stripped at import", () => {
    expect(decodeMorphCode("C")).toBe("conjunction");
    expect(decodeMorphCode("P")).toBe("preposition");
  });

  it("falls back to the part of speech for an unknown remainder", () => {
    expect(decodeMorphCode("N-XYZ")).toBe("noun");
  });

  it("returns null for unknown codes", () => {
    expect(decodeMorphCode("ZZTOP")).toBeNull();
    expect(decodeMorphCode("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/morphology.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the decoder**

Create `lib/morphology.ts`:

```ts
// Decodes MorphGNT-derived codes as stored on Token.morphCode by
// scripts/import-open-bible.ts: `${partOfSpeech}${parsingCode minus leading dashes}`
// with trailing dashes stripped from the whole string.
// Real shapes: "N-NSM", "RANSM", "V-3PAI-S" (finite), "V-PAPNSM" (participle),
// "V-PAN" (infinitive), "C" (indeclinable — the strip ate the dash of "C-").

const POS_LABELS: Record<string, string> = {
  "A-": "adjective",
  "C-": "conjunction",
  "D-": "adverb",
  "I-": "interjection",
  "N-": "noun",
  "P-": "preposition",
  RA: "article",
  RD: "demonstrative pronoun",
  RI: "interrogative/indefinite pronoun",
  RP: "personal pronoun",
  RR: "relative pronoun",
  "V-": "verb",
  "X-": "particle"
};

const CASES: Record<string, string> = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const NUMBERS: Record<string, string> = { S: "singular", P: "plural" };
const GENDERS: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" };
const TENSES: Record<string, string> = { P: "present", I: "imperfect", F: "future", A: "aorist", X: "perfect", Y: "pluperfect" };
const VOICES: Record<string, string> = { A: "active", M: "middle", P: "passive" };
const MOODS: Record<string, string> = { I: "indicative", D: "imperative", S: "subjunctive", O: "optative" };
const DEGREES: Record<string, string> = { C: "comparative", S: "superlative" };
const PERSON_ORDINALS: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

export function decodeMorphCode(morphCode: string): string | null {
  const code = morphCode.trim();
  if (!code) return null;
  const pos = code.length === 1 ? `${code}-` : code.slice(0, 2);
  const posLabel = POS_LABELS[pos];
  if (!posLabel) return null;

  const rest = code.slice(2).replace(/^-/, "");
  if (!rest) return posLabel;

  const detail = pos === "V-" ? decodeVerb(rest) : decodeNominal(rest);
  return detail ? `${posLabel} — ${detail}` : posLabel;
}

function decodeNominal(rest: string): string | null {
  const match = rest.match(/^([NGDAV])([SP])([MFN])([CS])?$/);
  if (!match) return null;
  const [, caseCode, numberCode, genderCode, degreeCode] = match;
  const base = `${CASES[caseCode]} ${NUMBERS[numberCode]} ${GENDERS[genderCode]}`;
  return degreeCode ? `${base}, ${DEGREES[degreeCode]}` : base;
}

function decodeVerb(rest: string): string | null {
  const finite = rest.match(/^([123])([PIFAXY])([AMP])([IDSO])-([SP])$/);
  if (finite) {
    const [, person, tense, voice, mood, number] = finite;
    return `${TENSES[tense]} ${VOICES[voice]} ${MOODS[mood]}, ${PERSON_ORDINALS[person]} person ${NUMBERS[number]}`;
  }
  const participle = rest.match(/^([PIFAXY])([AMP])P([NGDAV])([SP])([MFN])$/);
  if (participle) {
    const [, tense, voice, caseCode, number, gender] = participle;
    return `${TENSES[tense]} ${VOICES[voice]} participle, ${CASES[caseCode]} ${NUMBERS[number]} ${GENDERS[gender]}`;
  }
  const infinitive = rest.match(/^([PIFAXY])([AMP])N$/);
  if (infinitive) {
    const [, tense, voice] = infinitive;
    return `${TENSES[tense]} ${VOICES[voice]} infinitive`;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/morphology.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tooltip + component test**

Append to `tests/unit/components/SearchPanel.test.tsx`:

```tsx
describe("SearchPanel morph tooltip", () => {
  it("explains the morph code via a title tooltip", () => {
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='lemma "λόγος"' count={1} pageCount={1} results={[tokenResult]} />
    );
    expect(screen.getByTitle("noun — nominative singular masculine")).toBeTruthy();
  });
});
```

In `components/SearchPanel.tsx`, add `import { decodeMorphCode } from "@/lib/morphology";` and change the morph badge to:

```tsx
<span
  title={decodeMorphCode(result.morphCode) ?? undefined}
  className="cursor-help rounded bg-blue-50 px-2 py-1 text-xs text-blue-900"
>
  {result.morphCode}
</span>
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add lib/morphology.ts components/SearchPanel.tsx tests/unit/lib/morphology.test.ts tests/unit/components/SearchPanel.test.tsx
git commit -m "Decode morphology codes into human-readable tooltips on search results" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.3: Saved-search book names + domain-save explanation

**Files:**
- Modify: `components/SearchPanel.tsx` (saved-search sidebar ~line 471; results header ~line 363)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("SearchPanel saved searches", () => {
  it("shows friendly book names instead of osis ids", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "s1", label: "lemma: ἀγάπη", mode: "lemma", query: "ἀγάπη", book: "1Cor", chapter: null, matchMode: null }
        ]}
      />
    );
    expect(screen.getByText(/in 1 Corinthians/)).toBeTruthy();
  });

  it("explains that domain searches cannot be saved", () => {
    render(<SearchPanel {...baseProps} mode="domain" domain="025" hasSearch={true} searchLabel="Domain 25" />);
    expect(screen.getByText(/can't be saved yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `components/SearchPanel.tsx`, extend the references import to `import { bookName, readerHref } from "@/lib/references";`, then change the saved-search sub-line:

```tsx
<span className="mt-1 block text-xs text-slate-500">
  {item.mode} {item.book ? `in ${bookName(item.book)}` : "in all books"}
</span>
```

And change the results-header save block from `{query ? (...) : null}` to:

```tsx
{query ? (
  /* existing Save search button + status block, unchanged */
) : hasSearch && mode === "domain" ? (
  <p className="mt-3 text-sm text-slate-500">Domain searches can&apos;t be saved yet.</p>
) : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS. (Acceptance link assertion `/lemma: λόγος/` matches the label line, which is unchanged.)

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Show friendly book names on saved searches and explain domain-save gap" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.4: Absolute range in pagination text

**Files:**
- Modify: `components/SearchPanel.tsx:419-421` and the derived values near `previousPage`
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel pagination", () => {
  it("shows the absolute result range", () => {
    const results = Array.from({ length: 25 }, (_, i) => ({ ...tokenResult, reference: `John 1:${i + 1}` }));
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' results={results} count={116} page={2} pageCount={5} />
    );
    expect(screen.getByText(/Showing 26–50 of 116/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Next to the `previousPage`/`nextPage` consts add:

```tsx
const rangeStart = results.length === 0 ? 0 : (page - 1) * pageSize + 1;
const rangeEnd = results.length === 0 ? 0 : rangeStart + results.length - 1;
```

Replace `Showing {results.length} of {count}` with:

```tsx
Showing {rangeStart}–{rangeEnd} of {count}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Show absolute result range in search pagination" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.5: Page size as a select

**Files:**
- Modify: `components/SearchPanel.tsx:328-338`
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel page size", () => {
  it("offers standard page sizes as a select", () => {
    render(<SearchPanel {...baseProps} />);
    const select = screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement;
    expect(select.value).toBe("25");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["10", "25", "50", "100"]);
  });

  it("keeps a non-standard size from the URL selectable", () => {
    render(<SearchPanel {...baseProps} pageSize={37} />);
    const select = screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement;
    expect(select.value).toBe("37");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — page size is a spinbutton, not a combobox.

- [ ] **Step 3: Implement**

Add near the other derived consts:

```tsx
const pageSizeOptions = Array.from(new Set([10, 25, 50, 100, pageSize])).sort((a, b) => a - b);
```

Replace the Page size `<input type="number" ...>` with:

```tsx
<select
  name="pageSize"
  defaultValue={String(pageSize)}
  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
>
  {pageSizeOptions.map((size) => (
    <option key={size} value={size}>
      {size}
    </option>
  ))}
</select>
```

(The select stays inside the form's filter row: it must be a form field to be included in the GET submit.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Use a select for search page size" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.6: Chapter filter — numeric and dependent on book

**Files:**
- Modify: `components/SearchPanel.tsx` (book select ~line 310, chapter input ~line 320)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel chapter filter", () => {
  it("disables chapter until a book is chosen", () => {
    render(<SearchPanel {...baseProps} />);
    const chapterInput = screen.getByPlaceholderText("Choose a book first") as HTMLInputElement;
    expect(chapterInput.disabled).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Book" }), { target: { value: "John" } });
    expect((screen.getByPlaceholderText("Any") as HTMLInputElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add state alongside the existing useStates:

```tsx
const [selectedBook, setSelectedBook] = useState(book);
```

Make the book select controlled (replace `defaultValue={book}`):

```tsx
<select
  name="book"
  value={selectedBook}
  onChange={(event) => setSelectedBook(event.target.value)}
  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
>
```

Replace the chapter input:

```tsx
<input
  name="chapter"
  type="number"
  min="1"
  defaultValue={chapter}
  disabled={!selectedBook}
  placeholder={selectedBook ? "Any" : "Choose a book first"}
  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600 disabled:bg-stone-50 disabled:opacity-60"
/>
```

(A disabled input is excluded from the GET submit, so clearing the book also drops a leftover chapter — desired.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Make chapter filter numeric and dependent on book selection" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.7: Consistent submit placement in domain mode

**Files:**
- Modify: `components/SearchPanel.tsx` (domain grid)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel domain submit", () => {
  it("renders a labeled Search button in domain mode", () => {
    render(<SearchPanel {...baseProps} mode="domain" domain="" />);
    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });
});
```

(Note: the existing icon-only button also has `aria-label="Search"`, so this test only fails after Step 3 removes the in-field icon button — run it after the change to confirm the new shape, and rely on the visual check for placement.)

- [ ] **Step 2: Implement**

Change the domain grid wrapper from `sm:grid-cols-3` to `sm:grid-cols-[1fr_1fr_1fr_auto]`. In the LN-reference label, remove the wrapping `div.flex` and the icon submit button so it is just:

```tsx
<label className="space-y-1">
  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LN reference</span>
  <input
    name="ln"
    value={lnValue}
    onChange={(event) => setLnValue(event.target.value)}
    placeholder={MODE_HINTS.domain.placeholder}
    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
  />
</label>
```

Add as the grid's fourth cell:

```tsx
<button
  type="submit"
  className="self-end rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800"
>
  Search
</button>
```

- [ ] **Step 3: Run tests and visual check**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS. Then `npm run dev` → `/search`, Domain mode: the Search button sits at the row end, baseline-aligned with the three fields, and wraps cleanly on a narrow window.

- [ ] **Step 4: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Give domain mode a consistent standalone Search button" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2.8: Phase 2 verification and PR

- [ ] **Step 1:** Run `npm run verify` — expected all green.
- [ ] **Step 2:** Run `npm run test:acceptance` — expected PASS with the Task 2.1 assertion update.
- [ ] **Step 3: Push and open PR**

```powershell
git push -u origin feat/search-ui-phase2
gh pr create --title "Search UI phase 2: labels, morph tooltips, saved-search and filter polish" --body "Implements Phase 2 (medium) of docs/superpowers/plans/2026-06-10-search-ui-improvements.md: mode+scope in results label (acceptance assertion updated), human-readable morphology tooltips, friendly book names on saved searches, domain-save explanation, absolute pagination range, page-size select, dependent numeric chapter filter, consistent domain-mode submit."
```

- [ ] **Step 4:** Review bot comments, merge when `gate` is green.

---

# Phase 3 — Accessibility + visual polish

Branch: `feat/search-ui-phase3` (from `main` after Phase 2 merges).

### Task 3.0: Branch setup

- [ ] **Step 1:**

```powershell
git checkout main; git pull; git checkout -b feat/search-ui-phase3
```

### Task 3.1: Live regions for status messages

**Files:**
- Modify: `components/SearchPanel.tsx` (save status ~line 374; row status ~line 494)
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel status live regions", () => {
  it("announces save status via a polite live region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          savedSearch: { id: "n1", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
        })
      })
    );
    render(<SearchPanel {...baseProps} query="light" hasSearch={true} searchLabel='keyword "light"' />);
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Search saved.")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — no `status` role.

- [ ] **Step 3: Implement**

A live region must already be in the DOM when its text changes, so render both status nodes unconditionally. Replace:

```tsx
{saveStatus ? <span className="text-sm text-slate-600">{saveStatus}</span> : null}
```

with:

```tsx
<span role="status" aria-live="polite" className="text-sm text-slate-600">
  {saveStatus ?? ""}
</span>
```

and replace the per-row status:

```tsx
{itemStatus[item.id] ? (
  <span className="ml-auto text-slate-500">{itemStatus[item.id]}</span>
) : null}
```

with:

```tsx
<span role="status" aria-live="polite" className="ml-auto text-slate-500">
  {itemStatus[item.id] ?? ""}
</span>
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Announce search status messages via aria-live regions" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3.2: Label the saved-search rename input

**Files:**
- Modify: `components/SearchPanel.tsx:441-455`
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel rename input", () => {
  it("exposes an accessible name", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "s1", label: "keyword: light", mode: "keyword", query: "light", book: null, chapter: null, matchMode: null }
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(screen.getByRole("textbox", { name: "Saved search name" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `aria-label="Saved search name"` to the rename `<input>`:

```tsx
<input
  autoFocus
  aria-label="Saved search name"
  defaultValue={item.label}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx` → PASS.

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Label the saved-search rename input for assistive tech" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3.3: Disabled pagination as non-links

**Files:**
- Modify: `components/SearchPanel.tsx:409-431`
- Test: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("SearchPanel disabled pagination", () => {
  it("renders disabled pagination as text, not focusable links", () => {
    render(
      <SearchPanel {...baseProps} hasSearch={true} searchLabel='"x"' results={[tokenResult]} count={50} page={1} pageCount={2} />
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — Previous is still a link with `pointer-events-none`.

- [ ] **Step 3: Implement**

Replace the Previous link with:

```tsx
{page <= 1 ? (
  <span aria-disabled="true" className="rounded-md border border-stone-200 px-3 py-2 text-slate-400">
    Previous
  </span>
) : (
  <Link
    className="rounded-md border border-stone-300 px-3 py-2 hover:border-slate-500"
    href={searchHref({ mode, query, book, chapter, matchMode, domain, subdomain, ln, page: previousPage, pageSize })}
  >
    Previous
  </Link>
)}
```

and the Next link with the mirrored version (`page >= pageCount` → span; otherwise Link to `nextPage`).

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx` → PASS.

```powershell
git add components/SearchPanel.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Render disabled pagination controls as text instead of dead links" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3.4: Codex-rule hover treatment on result rows

**Files:**
- Modify: `components/SearchPanel.tsx:380` (result `<article>`)

- [ ] **Step 1: Implement** (visual-only; covered by existing render tests)

Change the result article class from `p-4` to:

```tsx
<article
  key={`${result.reference}-${index}`}
  className="border-l-2 border-transparent p-4 transition-colors hover:border-accent-400 hover:bg-stone-50/70"
>
```

- [ ] **Step 2: Verify**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx` → PASS (no behavior change). Visual check in `npm run dev`: hovering a result shows a 2px accent left rule echoing the app's codex motif, with a faint paper-tint background.

- [ ] **Step 3: Commit**

```powershell
git add components/SearchPanel.tsx
git commit -m "Add codex-rule hover treatment to search result rows" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3.5: Sticky search form on tall result pages

**Files:**
- Modify: `components/SearchPanel.tsx:203` (form element)

- [ ] **Step 1: Implement**

Add sticky classes to the form (xl and up only, where the two-column layout is active):

```tsx
<form className="space-y-3 rounded-md border border-stone-300 bg-white p-4 shadow-sm xl:sticky xl:top-6 xl:z-10" action="/search">
```

- [ ] **Step 2: Visual check**

`npm run dev` → run a multi-page search at xl width and scroll: the form stays pinned with its white card background fully opaque over passing results, and does not collide with the global header. If the global header overlaps, increase `xl:top-6` to clear it (check the header's height in `app/layout.tsx` and adjust to e.g. `xl:top-20`).

- [ ] **Step 3: Run the suite, then commit**

Run: `npx vitest run tests/unit/components/SearchPanel.test.tsx` → PASS.

```powershell
git add components/SearchPanel.tsx
git commit -m "Pin the search form while scrolling long result lists" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3.6: Docs refresh, final verification, and PR

**Files:**
- Modify: `README.md` (Product Surface → Search bullet), `docs/PROJECT_STATE.md`

- [ ] **Step 1: Update README (holistic pass, per CLAUDE.md)**

CLAUDE.md requires README.md to read as **one coherent, unified document** that someone new to the project can understand — not a patchwork of appended notes. The user revamped the README on 2026-06-09; preserve its structure and format. Concretely:

1. Read the ENTIRE README first, not just the Search section.
2. Integrate the new search behavior into the existing prose/bullet style wherever search is described — at minimum: the `/search` Product Surface bullets (segmented mode control with per-mode hints, example-search empty state, result references linking into the reader for on-spine hits, morphology tooltips, dependent chapter filter, per-mode no-results guidance), and any other section that mentions search behavior (e.g. the Smoke Path step that exercises `/search`, the intro feature summary) so no section contradicts another.
3. Do NOT bolt on a "what's new" list or changelog-style additions; rewrite the affected sentences/bullets in place so the document reads as if written in one sitting.
4. After editing, re-read the full README top to bottom and fix any inconsistencies introduced (terminology, tense, duplicate mentions).

- [ ] **Step 2: Update PROJECT_STATE**

Add a short subsection under "Post-review feature work" titled "Search UI improvements (2026-06)" listing the three phases and their PR numbers, and note the new helpers (`readerHref`, `searchStateKey`, `searchLabel`, `decodeMorphCode`), the `onSpine` keyword-result flag (Codex P2 fix on the Phase 1 PR), plus the acceptance-script label update.

- [ ] **Step 3: Final verification**

Run: `npm run verify` then `npm run test:acceptance`
Expected: all green.

- [ ] **Step 4: Push and open PR**

```powershell
git push -u origin feat/search-ui-phase3
gh pr create --title "Search UI phase 3: accessibility and visual polish" --body "Implements Phase 3 of docs/superpowers/plans/2026-06-10-search-ui-improvements.md: aria-live status regions, labeled rename input, disabled pagination as non-links, codex-rule hover on result rows, sticky search form, and README/PROJECT_STATE refresh."
```

- [ ] **Step 5:** Review bot comments, merge when `gate` is green.

---

## Out of scope (deliberately)

- Saving domain searches (server schema + API change — tracked as a known v1 gap, now at least explained in the UI).
- Numbered page-jump pagination (Previous/Next + range text is sufficient at current corpus scale).
- Mobile-friendly tooltips for morph codes (the `title` attribute is desktop-only; revisit if mobile usage grows).
- NT book-group `<optgroup>`s in the Book dropdown.
