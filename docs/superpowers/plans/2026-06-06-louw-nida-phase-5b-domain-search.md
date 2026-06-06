# Phase 5b — Louw-Nida Domain Search & Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `domain` mode to `/search` (domain + subdomain dropdowns + free-text LN-reference field) and explicit domain/LN-ref retrieval in the assistant, both backed by a single `searchDomain` helper over the Phase 5a Louw-Nida token arrays.

**Architecture:** A new `searchDomain` helper in `lib/search.ts` resolves one of three filters (LN ref → `louwNida has`; subdomain → `lnDomain has`; domain → `lnDomain hasSome [domain + its subdomain codes]`) and returns the existing token-result shape (so matched Greek words highlight for free). The `/search` page gains a domain branch + dropdown data; `SearchPanel` gains the domain controls. The assistant gains an explicit-only `domainQuery` signal and a planner `domainCall` mirroring `lemmaCall`.

**Tech Stack:** Next.js 15 / React 19 / TypeScript 5.8, Prisma 6 over PostgreSQL (Neon), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-06-louw-nida-domain-search-design.md`. Phase 5a (the data + schema this builds on) is merged on `main` (`6ec059d`).

**Windows/TLS note:** prefix `npx prisma …`, `npm …`, and DB scripts with `$env:NODE_OPTIONS="--use-system-ca"`. For one-off DB checks use `node --env-file=.env -e "…"` (Node 24). **`.env` is the primary Neon branch; `.env.test` is the louw-nida regression branch** (both already have the Phase 5a migration + data).

**Branch:** `milestone-3/phase-5b-domain-search` (already created; the spec commit is on it).

**Anchored detection (now in the spec §4):** the assistant's dotted-ref detection fires on `LN 33.55` / `Louw-Nida 33.55`, NOT a bare `33.55`, so chapter.verse notation like "John 3.16" can never trip domain retrieval. Bare dotted refs remain available via the `/search` LN field.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `prisma/schema.prisma` + new migration | GIN index on `Token.louwNida` | Modify / Create |
| `lib/search.ts` | `resolveDomainFilter`, `normalizeDomainCode`, `domainTokenWhere` (pure); `searchDomain`, `getLouwNidaDomainOptions` (DB) | Modify |
| `app/search/page.tsx` | Domain dispatch + load dropdown options + `hasSearch`/label props | Modify |
| `components/SearchPanel.tsx` | Domain-mode controls, dependent subdomain, generalized result gating, `searchHref` domain params | Modify |
| `lib/ai/signals.ts` | `DomainQuerySignal`, `detectDomainQuery`, `Signals.domainQuery`, marker stripping | Modify |
| `lib/ai/retrievalPlanner.ts` | `domainCall` + `buildPlan` injection | Modify |
| `tests/unit/lib/search-domain.test.ts` | Pure-helper unit tests | Create |
| `tests/unit/lib/ai/signals.test.ts` | `detectDomainQuery` tests | Modify |
| `tests/unit/lib/ai/retrievalPlanner.test.ts` | `domainCall` planner tests | Modify |
| `tests/integration/louw-nida-search.test.ts` | `searchDomain` modes + GIN index end-to-end | Create |
| `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md` | Docs | Modify |

---

## Task 1: Schema — GIN index on `Token.louwNida`

**Files:**
- Modify: `prisma/schema.prisma` (Token index block)
- Create: `prisma/migrations/<timestamp>_louw_nida_search_index/migration.sql`

- [ ] **Step 1: Add the index to the schema**

In `model Token`, add after the existing `@@index([lnDomain], type: Gin)` line:
```prisma
  @@index([louwNida], type: Gin)
```

- [ ] **Step 2: Hand-author the migration (avoid `migrate dev` drift)**

`migrate dev` trips on the pre-existing pgvector/generated-column drift (see Phase 5a Task 2). Create the folder and SQL by hand. Make the timestamp later than `20260606070628_add_louw_nida`:
```powershell
New-Item -ItemType Directory -Force prisma/migrations/20260607000000_louw_nida_search_index | Out-Null
```
Create `prisma/migrations/20260607000000_louw_nida_search_index/migration.sql`. Use `IF NOT EXISTS` so the
migration is idempotent — if the index was ever created out-of-band on a branch, a later `migrate deploy`
records the migration without erroring on a duplicate index:
```sql
-- CreateIndex
CREATE INDEX IF NOT EXISTS "Token_louwNida_idx" ON "Token" USING GIN ("louwNida");
```

- [ ] **Step 3: Apply to the primary branch and verify**

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
```
Expected: the new migration applies; `migrate status` reports "Database schema is up to date!".

- [ ] **Step 4: Validate + type-check**

```powershell
npx prisma validate
npx tsc --noEmit
```
Both exit 0.

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add GIN index on Token.louwNida for LN-reference search"
```

---

## Task 2: Pure domain-filter helpers (`lib/search.ts`) — TDD

**Files:**
- Modify: `lib/search.ts`
- Test: `tests/unit/lib/search-domain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/search-domain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizeDomainCode, resolveDomainFilter, domainTokenWhere } from "@/lib/search";

describe("normalizeDomainCode", () => {
  it("left-pads short domain numbers to 3 digits", () => {
    expect(normalizeDomainCode("33")).toBe("033");
    expect(normalizeDomainCode("1")).toBe("001");
    expect(normalizeDomainCode("033")).toBe("033");
  });
  it("strips non-digits", () => {
    expect(normalizeDomainCode(" 33 ")).toBe("033");
  });
});

describe("resolveDomainFilter", () => {
  it("applies precedence ln > subdomain > domain", () => {
    expect(resolveDomainFilter({ ln: "33.55", subdomain: "033006", domain: "33" })).toEqual({ kind: "ln", value: "33.55" });
    expect(resolveDomainFilter({ subdomain: "033006", domain: "33" })).toEqual({ kind: "subdomain", value: "033006" });
    expect(resolveDomainFilter({ domain: "33" })).toEqual({ kind: "domain", value: "033" });
  });
  it("returns null when nothing is provided", () => {
    expect(resolveDomainFilter({})).toBeNull();
    expect(resolveDomainFilter({ ln: "  ", subdomain: "", domain: "" })).toBeNull();
  });
});

describe("domainTokenWhere", () => {
  it("builds an exact louwNida filter for an ln ref", () => {
    expect(domainTokenWhere({ kind: "ln", value: "33.55" }, [])).toEqual({ louwNida: { has: "33.55" } });
  });
  it("builds an exact lnDomain filter for a subdomain", () => {
    expect(domainTokenWhere({ kind: "subdomain", value: "033006" }, [])).toEqual({ lnDomain: { has: "033006" } });
  });
  it("builds an overlap lnDomain filter for a domain (own code + children)", () => {
    expect(domainTokenWhere({ kind: "domain", value: "033" }, ["033", "033006", "033007"])).toEqual({
      lnDomain: { hasSome: ["033", "033006", "033007"] }
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/search-domain.test.ts`
Expected: FAIL — the three functions are not exported from `@/lib/search`.

- [ ] **Step 3: Implement the helpers**

In `lib/search.ts`, near the other search helpers, add (the `Prisma` type is already imported in this file):
```ts
export type DomainFilter =
  | { kind: "ln"; value: string }
  | { kind: "subdomain"; value: string }
  | { kind: "domain"; value: string };

// "33" → "033"; already-3+-digit values are left as-is. Strips non-digits defensively.
export function normalizeDomainCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length < 3 ? digits.padStart(3, "0") : digits;
}

// Most-specific filter wins: ln → subdomain → domain.
export function resolveDomainFilter(input: { ln?: string; subdomain?: string; domain?: string }): DomainFilter | null {
  const ln = input.ln?.trim();
  if (ln) return { kind: "ln", value: ln };
  const subdomain = input.subdomain?.trim();
  if (subdomain) return { kind: "subdomain", value: subdomain };
  const domain = input.domain?.trim();
  if (domain) return { kind: "domain", value: normalizeDomainCode(domain) };
  return null;
}

// `domainCodes` is the expanded [domain code + its subdomain codes]; only used for the domain kind.
export function domainTokenWhere(filter: DomainFilter, domainCodes: string[]): Prisma.TokenWhereInput {
  if (filter.kind === "ln") return { louwNida: { has: filter.value } };
  if (filter.kind === "subdomain") return { lnDomain: { has: filter.value } };
  return { lnDomain: { hasSome: domainCodes } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/search-domain.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```powershell
git add lib/search.ts tests/unit/lib/search-domain.test.ts
git commit -m "Add pure domain-filter resolution helpers"
```

---

## Task 3: `searchDomain` + `getLouwNidaDomainOptions` (`lib/search.ts`)

**Files:**
- Modify: `lib/search.ts`

> These touch the DB; their behavior is verified end-to-end in Task 8's integration test. Mirror `searchLemma` (read it first — `lib/search.ts` ~`501-544`) for the token-query + `hydrateTokens` + pagination shape.

- [ ] **Step 1: Implement `searchDomain`**

In `lib/search.ts`, add (reuses the file's existing `normalizeBook`, `normalizePagination`, `paginationResult`, `hydrateTokens`, `prisma`, `Prisma`, and the helpers from Task 2):
```ts
export async function searchDomain(input: {
  domain?: string;
  subdomain?: string;
  ln?: string;
  corpus?: "SBLGNT";
  book?: string;
  chapter?: number;
} & PaginationInput) {
  const filter = resolveDomainFilter(input);
  const book = normalizeBook(input.book);
  const pagination = normalizePagination(input);
  const empty = { filter, count: 0, results: [] as Awaited<ReturnType<typeof hydrateTokens>>, pagination: { ...pagination, total: 0, pageCount: 0 } };

  if (!filter) return empty;

  let domainCodes: string[] = [];
  if (filter.kind === "domain") {
    const rows = await prisma.louwNidaDomain.findMany({
      where: { OR: [{ code: filter.value }, { parentCode: filter.value }] },
      select: { code: true }
    });
    domainCodes = rows.map((r) => r.code);
    if (domainCodes.length === 0) return empty;
  }

  const where: Prisma.TokenWhereInput = {
    ...domainTokenWhere(filter, domainCodes),
    corpus: { abbreviation: input.corpus ?? "SBLGNT" },
    book: book ? { osisId: book } : undefined,
    chapter: input.chapter
  };

  const [total, tokens] = await Promise.all([
    prisma.token.count({ where }),
    prisma.token.findMany({
      where,
      include: { book: true, corpus: true },
      orderBy: [{ book: { order: "asc" } }, { chapter: "asc" }, { verse: "asc" }, { wordIndex: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize
    })
  ]);

  const results = await hydrateTokens(tokens);
  return { filter, count: total, pagination: paginationResult(pagination, total), results };
}
```

- [ ] **Step 2: Implement `getLouwNidaDomainOptions`**

Add:
```ts
export type DomainOption = { code: string; number: number; label: string };
export type DomainOptions = { domains: DomainOption[]; subdomainsByDomain: Record<string, { code: string; label: string }[]> };

export async function getLouwNidaDomainOptions(): Promise<DomainOptions> {
  const rows = await prisma.louwNidaDomain.findMany({
    where: { level: { in: [1, 2] } },
    select: { code: true, level: true, label: true, parentCode: true }
  });
  const domains = rows
    .filter((r) => r.level === 1)
    .map((r) => ({ code: r.code, number: Number.parseInt(r.code, 10), label: r.label }))
    .sort((a, b) => a.number - b.number);
  const subdomainsByDomain: Record<string, { code: string; label: string }[]> = {};
  for (const r of rows) {
    if (r.level === 2 && r.parentCode) {
      (subdomainsByDomain[r.parentCode] ??= []).push({ code: r.code, label: r.label });
    }
  }
  for (const code of Object.keys(subdomainsByDomain)) {
    subdomainsByDomain[code].sort((a, b) => a.code.localeCompare(b.code));
  }
  return { domains, subdomainsByDomain };
}
```

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Optional spot-check against the primary branch**

Write a throwaway `tmp-domain-check.ts` and run it with `tsx` (deleting it after), or rely on Task 8's integration test as the real verification:
```powershell
$env:NODE_OPTIONS="--use-system-ca"
"import { searchDomain } from './lib/search'; searchDomain({ ln: '33.55', pageSize: 3 }).then(r => { console.log('ln 33.55 count:', r.count); process.exit(0); });" | Out-File -Encoding utf8 tmp-domain-check.ts
npx tsx --env-file=.env tmp-domain-check.ts
Remove-Item tmp-domain-check.ts
```
Expected: a non-zero `ln 33.55 count`.

- [ ] **Step 5: Commit**

```powershell
git add lib/search.ts
git commit -m "Add searchDomain and getLouwNidaDomainOptions helpers"
```

---

## Task 4: `/search` server dispatch (`app/search/page.tsx`)

**Files:**
- Modify: `app/search/page.tsx`

- [ ] **Step 1: Import the new helpers + load options**

Change the import on line 7 to add the two helpers:
```ts
import { getAvailableReaderBooks, getLouwNidaDomainOptions, searchDomain, searchKeyword, searchLemma, searchMorphology } from "@/lib/search";
```

- [ ] **Step 2: Read domain params + add the domain dispatch branch**

After the existing param reads (around line 23, after `matchMode`), add:
```ts
  const domain = getParam(params.domain) ?? "";
  const subdomain = getParam(params.subdomain) ?? "";
  const ln = getParam(params.ln) ?? "";
```
Add `hasSearch` + `searchLabel` locals near `let page = requestedPage;`:
```ts
  let hasSearch = false;
  let searchLabel = "";
```
Load the domain options **before** the dispatch (the domain branch needs them for the header label):
```ts
  const domainOptions = await getLouwNidaDomainOptions();
```
Add a module-level label helper at the bottom of the file (next to `getParam`):
```ts
function domainSearchLabel(
  filter: { kind: "ln" | "subdomain" | "domain"; value: string } | null,
  options: DomainOptions
): string {
  if (!filter) return "";
  if (filter.kind === "ln") return `LN ${filter.value}`;
  if (filter.kind === "subdomain") {
    const parent = filter.value.slice(0, 3);
    const sub = options.subdomainsByDomain[parent]?.find((s) => s.code === filter.value);
    return sub ? `Subdomain: ${sub.label}` : `Subdomain ${filter.value}`;
  }
  const domain = options.domains.find((d) => d.code === filter.value);
  return domain ? `Domain ${domain.number} — ${domain.label}` : `Domain ${Number.parseInt(filter.value, 10)}`;
}
```
Import the `DomainOptions` type alongside the helpers (Step 1's import line already adds the functions; also add the type):
```ts
import type { DomainOptions } from "@/lib/search";
```
Replace the `if (query.trim()) { … }` block's opening so the domain branch runs first:
```ts
  if (mode === "domain" && (domain || subdomain || ln)) {
    const search = await searchDomain({
      domain: domain || undefined,
      subdomain: subdomain || undefined,
      ln: ln || undefined,
      book: book || undefined,
      chapter: parsedChapter,
      page: requestedPage,
      pageSize
    });
    count = search.count;
    pageCount = search.pagination.pageCount;
    results = search.results.map((result) => ({ kind: "token" as const, ...result }));
    hasSearch = true;
    searchLabel = domainSearchLabel(search.filter, domainOptions);
    page = Math.min(requestedPage, Math.max(pageCount, 1));
  } else if (query.trim()) {
    // ...existing lemma/morphology/keyword branches unchanged...
    hasSearch = true;
    searchLabel = `"${query}"`;
    page = Math.min(requestedPage, Math.max(pageCount, 1));
  }
```
(Move the existing `page = Math.min(...)` line inside the `else if` block, and set `hasSearch`/`searchLabel` there. Keep the lemma/morphology/keyword branches exactly as they are.)

- [ ] **Step 3: Pass new props to `SearchPanel`**

`domainOptions` is already loaded (Step 2). Leave the existing `Promise.all([books, savedSearches])` as-is.
Pass new props to `<SearchPanel … />`:
```tsx
        domain={domain}
        subdomain={subdomain}
        ln={ln}
        domainOptions={domainOptions}
        hasSearch={hasSearch}
        searchLabel={searchLabel}
```

- [ ] **Step 4: Type-check (will fail until Task 5 updates SearchPanel's props)**

Run: `npx tsc --noEmit`
Expected: errors ONLY about the new `SearchPanel` props not existing yet — that's expected; Task 5 adds them. Do not commit until Task 5 makes tsc clean.

- [ ] **Step 5: Commit (after Task 5 — see note)**

This task and Task 5 are committed together because the prop contract spans both. Proceed to Task 5; commit at Task 5 Step 6.

---

## Task 5: `SearchPanel` domain-mode UI (`components/SearchPanel.tsx`)

**Files:**
- Modify: `components/SearchPanel.tsx`

- [ ] **Step 1: Extend props + types**

Import the option type and add props. At the top imports add:
```ts
import type { DomainOptions } from "@/lib/search";
```
Add to the `SearchPanel({ … })` destructure and its type (after `savedSearches`):
```ts
  domain,
  subdomain,
  ln,
  domainOptions,
  hasSearch,
  searchLabel
```
```ts
  domain: string;
  subdomain: string;
  ln: string;
  domainOptions: DomainOptions;
  hasSearch: boolean;
  searchLabel: string;
```

- [ ] **Step 2: Add domain state + the Domain mode option**

After `const [activeMode, setActiveMode] = useState(mode);` add controlled state for the two dependent
dropdowns (LN stays an uncontrolled text input like Chapter/Book). Changing the domain **clears the
subdomain** so a stale subdomain code can't be submitted:
```ts
  const [selectedDomain, setSelectedDomain] = useState(domain);
  const [selectedSubdomain, setSelectedSubdomain] = useState(subdomain);
  function onDomainChange(value: string) {
    setSelectedDomain(value);
    setSelectedSubdomain("");
  }
```
In the Mode `<select>` options (after the Morphology option) add:
```tsx
              <option value="domain">Domain</option>
```

- [ ] **Step 3: Render domain controls instead of the Query box when in domain mode**

Wrap the existing Query `<label>` (the `name="q"` block, ~lines 188-220) so it only renders when NOT in domain mode, and render the domain controls when in domain mode. Replace the Query `<label>…</label>` with:
```tsx
          {activeMode === "domain" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domain</span>
                <select
                  name="domain"
                  value={selectedDomain}
                  onChange={(event) => onDomainChange(event.target.value)}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                >
                  <option value="">Any domain</option>
                  {domainOptions.domains.map((d) => (
                    <option key={d.code} value={d.code}>{`${d.number} — ${d.label}`}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subdomain</span>
                <select
                  name="subdomain"
                  value={selectedSubdomain}
                  onChange={(event) => setSelectedSubdomain(event.target.value)}
                  disabled={!selectedDomain}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="">Any subdomain</option>
                  {(domainOptions.subdomainsByDomain[selectedDomain] ?? []).map((s) => (
                    <option key={s.code} value={s.code}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LN reference</span>
                <div className="flex items-center gap-2">
                  <input
                    name="ln"
                    defaultValue={ln}
                    placeholder="e.g. 33.55"
                    className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-accent-600"
                  />
                  <button
                    type="submit"
                    aria-label="Search"
                    title="Search"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-accent-700 text-white transition-colors hover:bg-accent-800"
                  >
                    <Search size={16} aria-hidden />
                  </button>
                </div>
              </label>
            </div>
          ) : (
            <label className="space-y-1">
              {/* ...the EXISTING Query label block, unchanged... */}
            </label>
          )}
```
(Keep the existing Query `<label>` markup verbatim inside the `: ( … )` branch.)

- [ ] **Step 4: Generalize the results gating from `query` to `hasSearch` + `searchLabel`**

In the Results section: change the header text and gates.
- Replace the results-count paragraph (`~line 273-277`):
```tsx
          <p className="mt-1 text-sm text-slate-600">
            {hasSearch
              ? `${count} result${count === 1 ? "" : "s"} for ${searchLabel}${pageCount ? `, page ${page} of ${pageCount}` : ""}`
              : "Enter a search query."}
          </p>
```
- The Save-search affordance stays gated on `query` (so it is hidden in domain mode for v1 — saving domain searches is out of scope). Leave the `{query ? ( …Save… ) : null}` block as-is.
- Change the empty-results line gate (`~line 320`) and the pagination nav gate (`~line 324`) from `query` to `hasSearch`:
```tsx
          {hasSearch && results.length === 0 ? (
            <div className="p-4 text-sm text-slate-600">No matching sample-data results.</div>
          ) : null}
```
```tsx
        {hasSearch && pageCount > 1 ? (
```

- [ ] **Step 5: Carry domain params through `searchHref` (pagination links)**

Replace the `searchHref` function (`~line 442-471`) with one that includes domain params:
```ts
function searchHref({
  mode,
  query,
  book,
  chapter,
  matchMode,
  domain,
  subdomain,
  ln,
  page,
  pageSize
}: {
  mode: string;
  query: string;
  book: string;
  chapter: string;
  matchMode: string;
  domain?: string;
  subdomain?: string;
  ln?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams({ mode, page: String(page), pageSize: String(pageSize) });
  if (mode === "domain") {
    if (domain) params.set("domain", domain);
    if (subdomain) params.set("subdomain", subdomain);
    if (ln) params.set("ln", ln);
  } else {
    params.set("q", query);
    if (mode === "morphology") params.set("matchMode", matchMode);
  }
  if (book) params.set("book", book);
  if (chapter) params.set("chapter", chapter);
  return `/search?${params.toString()}`;
}
```
Update the two pagination `searchHref({ … })` calls (Previous ~line 330, Next ~line 341). Pass the
**submitted** mode and domain params — the `mode`/`domain`/`subdomain`/`ln` **props** (the query the server
actually ran), NOT the live `activeMode`/`selectedDomain`/`selectedSubdomain` state — exactly as lemma
pagination passes the `query` prop (not the live `queryValue`). This keeps page navigation tied to the
executed search even if the user has edited the form without resubmitting:
```tsx
              href={searchHref({ mode, query, book, chapter, matchMode, domain, subdomain, ln, page: previousPage, pageSize })}
```
```tsx
              href={searchHref({ mode, query, book, chapter, matchMode, domain, subdomain, ln, page: nextPage, pageSize })}
```
(The saved-search `searchHref` call keeps passing only its lemma/keyword fields — saved domain searches are out of scope, so `domain`/`subdomain`/`ln` are simply omitted there.)

- [ ] **Step 6: Type-check, lint, build, then commit Tasks 4 + 5 together**

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npx tsc --noEmit
npx eslint app/search/page.tsx components/SearchPanel.tsx
npm run build
```
All must pass (tsc 0; eslint 0; build compiles). Then:
```powershell
git add app/search/page.tsx components/SearchPanel.tsx
git commit -m "Add /search domain mode (domain/subdomain dropdowns + LN-ref field)"
```

- [ ] **Step 7: Manual smoke check**

`npm run dev`, sign in, open `/search?mode=domain&domain=033&book=John`. Expected: domain dropdown shows `33 — Communication` selected; results list Greek tokens in domain 33 in John, each matched word bolded. Try `/search?mode=domain&ln=33.55` and confirm exact-ref results.

---

## Task 6: Assistant `domainQuery` signal (`lib/ai/signals.ts`) — TDD

**Files:**
- Modify: `lib/ai/signals.ts`
- Test: `tests/unit/lib/ai/signals.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/ai/signals.test.ts` (it already imports from `@/lib/ai/signals`; add `detectDomainQuery`, `extractSignals` to the import if not present):
```ts
describe("detectDomainQuery", () => {
  it("detects an anchored domain number", () => {
    expect(detectDomainQuery("show me everything in domain 33 in John")).toEqual({ kind: "domain", code: "033" });
    expect(detectDomainQuery("Louw-Nida 1 words")).toEqual({ kind: "domain", code: "001" });
    expect(detectDomainQuery("LN 93 terms")).toEqual({ kind: "domain", code: "093" });
  });
  it("detects an anchored LN reference (ln wins over domain)", () => {
    expect(detectDomainQuery("uses of LN 33.55")).toEqual({ kind: "ln", ref: "33.55" });
    expect(detectDomainQuery("Louw-Nida 93.169a in Matthew")).toEqual({ kind: "ln", ref: "93.169a" });
  });
  it("does NOT fire on bare numbers, chapter.verse refs, or topical domain words", () => {
    expect(detectDomainQuery("what does John 3.16 mean")).toBeUndefined();
    expect(detectDomainQuery("Paul's view on communication in the church")).toBeUndefined();
    expect(detectDomainQuery("33.55")).toBeUndefined();
    expect(detectDomainQuery("domain 200 is out of range")).toBeUndefined();
  });
});

describe("extractSignals domainQuery", () => {
  it("attaches domainQuery and keeps it out of topic words", () => {
    const signals = extractSignals("show me domain 33 in John");
    expect(signals.domainQuery).toEqual({ kind: "domain", code: "033" });
    expect(signals.topicWords).not.toContain("domain");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/ai/signals.test.ts -t "domainQuery"`
Expected: FAIL — `detectDomainQuery` not exported / `signals.domainQuery` undefined.

- [ ] **Step 3: Add the type, detector, and wire into `extractSignals`**

In `lib/ai/signals.ts`, add the signal type and field. Extend `Signals` (after `phraseTerms?`):
```ts
  domainQuery?: DomainQuerySignal;
```
Add near the top types:
```ts
export type DomainQuerySignal = { kind: "domain"; code: string } | { kind: "ln"; ref: string };

// Anchored to an explicit Louw-Nida marker so ordinary text — including
// chapter.verse notation like "John 3.16" — never trips domain retrieval.
// Bare dotted refs are intentionally NOT detected here (the /search LN field
// handles those). `domain N` validates 1..93.
const LN_REF_RE = /(?:louw[\s-]?nida|\bln)\s+(\d{1,2})\.(\d{1,3}[a-z]?)\b/i;
const DOMAIN_NUM_RE = /(?:louw[\s-]?nida|\bln|\bdomain)\s+0*(\d{1,3})\b/i;

export function detectDomainQuery(prompt: string): DomainQuerySignal | undefined {
  const lnMatch = LN_REF_RE.exec(prompt);
  if (lnMatch) return { kind: "ln", ref: `${lnMatch[1]}.${lnMatch[2]}` };
  const domMatch = DOMAIN_NUM_RE.exec(prompt);
  if (domMatch) {
    const n = Number.parseInt(domMatch[1], 10);
    if (n >= 1 && n <= 93) return { kind: "domain", code: String(n).padStart(3, "0") };
  }
  return undefined;
}

function stripDomainMarkers(text: string): string {
  return text.replace(LN_REF_RE, " ").replace(DOMAIN_NUM_RE, " ");
}
```
In `extractSignals`, compute the domain query and strip its marker text before topic extraction:
```ts
  const domainQuery = detectDomainQuery(prompt);
  const topicSource = stripDomainMarkers(
    stripReferencesAndBookAliases(stripMorphCodes(phrases.cleaned))
  );
```
and add `domainQuery` to the returned object:
```ts
    phraseTerms: phrases.terms,
    domainQuery
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/ai/signals.test.ts`
Expected: PASS — the new tests plus all existing signals tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/ai/signals.ts tests/unit/lib/ai/signals.test.ts
git commit -m "Detect explicit Louw-Nida domain/LN-ref queries in assistant signals"
```

---

## Task 7: Planner `domainCall` (`lib/ai/retrievalPlanner.ts`) — TDD

**Files:**
- Modify: `lib/ai/retrievalPlanner.ts`
- Test: `tests/unit/lib/ai/retrievalPlanner.test.ts`

> Read `lemmaCall` (`lib/ai/retrievalPlanner.ts` ~`247-274`) and `buildPlan` (~`469-523`) first — `domainCall` mirrors `lemmaCall`.

- [ ] **Step 1: Write the failing test**

The existing `retrievalPlanner.test.ts` mocks `@/lib/search`. Add `searchDomain` to that mock and a test that a `domainQuery` signal produces a `searchDomain` tool-trace + evidence section. Add into the existing `vi.mock("@/lib/search", …)` factory a `searchDomain` mock, then:
```ts
it("adds a searchDomain call for an explicit domain query", async () => {
  vi.mocked(searchDomain).mockResolvedValue({
    filter: { kind: "domain", value: "033" },
    count: 2,
    pagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 },
    results: [
      { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
    ]
  } as never);

  const packet = await runRetrievalPlan(
    { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general", domainQuery: { kind: "domain", code: "033" } } as never,
    "show me domain 33",
    false
  );

  expect(packet.toolTrace.some((t) => t.tool === "searchDomain")).toBe(true);
  expect(packet.formattedEvidence).toContain("searchDomain(domain 033");
  expect(vi.mocked(searchDomain)).toHaveBeenCalled();
});

it("keeps the explicit domain call even when many topic words crowd the plan", async () => {
  vi.mocked(searchDomain).mockResolvedValue({
    filter: { kind: "domain", value: "033" },
    count: 1,
    pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
    results: [{ tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "…" }]
  } as never);

  // 12 topic words > MAX_PLANNED_CALLS (8) — the domain call must not be sliced off.
  const topicWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "mu", "nu"];
  const packet = await runRetrievalPlan(
    { references: [], greekWords: [], topicWords, morphCodes: [], intent: "general", domainQuery: { kind: "domain", code: "033" } } as never,
    `domain 33 ${topicWords.join(" ")}`,
    false
  );

  expect(packet.toolTrace.some((t) => t.tool === "searchDomain")).toBe(true);
});
```
(Match the exact import names/mock style already used in this test file. `searchDomain` must be added to the imports under test and to the `vi.mock` factory.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts -t "searchDomain"`
Expected: FAIL — no `searchDomain` trace (call not built yet).

- [ ] **Step 3: Implement `domainCall` + wire into `buildPlan`**

In `lib/ai/retrievalPlanner.ts`, add `searchDomain` to the `@/lib/search` import (line 4-12 block) and `type DomainQuerySignal` to the signals import (line 3):
```ts
import { ENGLISH_TO_GREEK_LEMMA, type DomainQuerySignal, type ParsedReference, type Signals } from "@/lib/ai/signals";
```
Add `searchDomain` to the destructured `@/lib/search` import. Then add a `domainCall` factory next to `lemmaCall`:
```ts
function domainCall(query: DomainQuerySignal, scope: Scope): PlannedCall {
  const args: { domain?: string; ln?: string; book?: string; chapter?: number } = {};
  if (query.kind === "domain") args.domain = query.code;
  else args.ln = query.ref;
  if (scope.book) args.book = scope.book;
  if (scope.chapter !== undefined) args.chapter = scope.chapter;
  const value = query.kind === "domain" ? `domain ${query.code}` : `ln ${query.ref}`;
  const label = `${value}${scope.book ? `, ${scope.book}` : ""}${scope.chapter !== undefined ? ` ${scope.chapter}` : ""}`;
  const searchQuery = query.kind === "domain" ? `domain:${query.code}` : `ln:${query.ref}`;
  return {
    key: `domain:${searchQuery}|${scope.book ?? ""}|${scope.chapter ?? ""}`,
    errorTrace: { tool: "searchDomain", args },
    run: async () => {
      const res = await searchDomain({ ...args, pageSize: MAX_WORD_SAMPLE });
      const citations = res.results.slice(0, MAX_SECTION_LINES).map((r) => ({
        reference: r.reference,
        corpus: r.corpus,
        searchQuery,
        toolName: "searchDomain",
        tokenId: r.tokenId
      }));
      const lines = res.results
        .slice(0, MAX_WORD_SAMPLE)
        .map((r) => `| ${r.reference} | ${r.surface} | ${r.morphCode} | ${r.verseText} |`);
      return {
        citations,
        section: sectionBlock(`searchDomain(${label}) — ${res.count} hit(s)`, lines, res.count),
        traces: [{ tool: "searchDomain", args }]
      };
    }
  };
}
```
In `buildPlan`, add the domain call **first** — immediately after `const topicTerms = classifyTopicTerms(signals, prompt);` and **before** the `for (const ref of signals.references)` loop. Adding it first guarantees it survives the `slice(0, MAX_PLANNED_CALLS)` (8) even when a prompt also carries many topic/morph signals (it is explicit user intent and must never be crowded out):
```ts
  if (signals.domainQuery) {
    add(domainCall(signals.domainQuery, scope));
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/ai/retrievalPlanner.test.ts`
Expected: PASS — the new test plus all existing planner tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/ai/retrievalPlanner.ts tests/unit/lib/ai/retrievalPlanner.test.ts
git commit -m "Add planner domainCall for explicit domain/LN-ref retrieval"
```

---

## Task 8: Integration tests (`tests/integration/louw-nida-search.test.ts`)

**Files:**
- Create: `tests/integration/louw-nida-search.test.ts`

> Runs via `npm run test:integration` against `.env.test` (the louw-nida branch already has the Phase 5a data + the Task 1 migration once deployed there).

- [ ] **Step 1: Apply the migration to the test branch via the migration path**

Apply through `prisma migrate deploy` (NOT raw SQL) so the test branch records a `_prisma_migrations` row and
won't drift. `prisma.config.ts` loads env via `dotenv/config`, and dotenv does not override pre-set vars, so
`node --env-file=.env.test` (which sets `DATABASE_URL` from the test branch first) makes the CLI target the
test branch:
```powershell
$env:NODE_OPTIONS="--use-system-ca"
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
```
Expected: applies the pending `20260607000000_louw_nida_search_index` migration to the test branch (the 5a
migrations are already recorded there); "All migrations have been successfully applied." Re-running is a
no-op ("No pending migrations").

- [ ] **Step 2: Write the integration test**

Create `tests/integration/louw-nida-search.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { searchDomain, getLouwNidaDomainOptions } from "@/lib/search";
import { prisma } from "@/lib/db";

const itDb = process.env.DATABASE_URL ? it : it.skip;

describe("Louw-Nida domain search (integration)", () => {
  itDb("created the louwNida GIN index with the intended shape", async () => {
    // Assert the full contract, not just the name: a same-named but wrong index
    // (e.g. a btree, or on the wrong column) would otherwise pass with IF NOT EXISTS.
    const rows = await prisma.$queryRaw<{ tablename: string; indexdef: string }[]>`
      SELECT tablename, indexdef FROM pg_indexes WHERE indexname = 'Token_louwNida_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].tablename).toBe("Token");
    expect(rows[0].indexdef).toMatch(/USING gin/i);
    expect(rows[0].indexdef).toContain('"louwNida"');
  });

  itDb("returns tokens for an exact LN reference", async () => {
    const res = await searchDomain({ ln: "33.55", pageSize: 5 });
    expect(res.count).toBeGreaterThan(0);
    expect(res.results.every((r) => typeof r.surface === "string")).toBe(true);
  });

  itDb("returns tokens for an exact subdomain code", async () => {
    const res = await searchDomain({ subdomain: "033006", pageSize: 5 });
    expect(res.count).toBeGreaterThan(0);
  });

  itDb("returns more for a whole domain than for one of its subdomains", async () => {
    const whole = await searchDomain({ domain: "033", pageSize: 1 });
    const sub = await searchDomain({ subdomain: "033006", pageSize: 1 });
    expect(whole.count).toBeGreaterThanOrEqual(sub.count);
    expect(whole.count).toBeGreaterThan(0);
  });

  itDb("scopes by book", async () => {
    const all = await searchDomain({ domain: "033", pageSize: 1 });
    const john = await searchDomain({ domain: "033", book: "John", pageSize: 1 });
    expect(john.count).toBeLessThanOrEqual(all.count);
  });

  itDb("exposes 93 domain options sorted by number", async () => {
    const opts = await getLouwNidaDomainOptions();
    expect(opts.domains.length).toBe(93);
    expect(opts.domains[0].number).toBe(1);
    expect(opts.subdomainsByDomain["033"]?.length ?? 0).toBeGreaterThan(0);
  });
});
```
(If `033006` yields 0 on the test branch, swap to a subdomain code the data actually has — confirm with `node --env-file=.env.test -e "…token.findFirst… select lnDomain"`.)

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS (6 new tests — index presence + ln/subdomain/domain/scope/options — plus the existing suites).

- [ ] **Step 4: Commit**

```powershell
git add tests/integration/louw-nida-search.test.ts
git commit -m "Add Louw-Nida domain search integration tests"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md`, `docs/PROJECT_STATE.md`, `docs/HiFi-exegesis-nt-roadmap.md`

- [ ] **Step 1: README**

In the Search section, document the new **domain** mode: domain dropdown (`33 — Communication`), dependent subdomain dropdown, and the free-text LN-reference field (`33.55`); note the assistant also answers explicit `domain 33` / `LN 33.55` prompts.

- [ ] **Step 2: PROJECT_STATE**

Add a Phase 5b entry under Milestone 3: new `Token.louwNida` GIN index + migration, `searchDomain` + `getLouwNidaDomainOptions`, the `/search` domain mode, the assistant `domainQuery` signal + planner `domainCall`. Add the migration to the migrations list and the new tests to the test-surfaces list. Update the snapshot date.

- [ ] **Step 3: Roadmap**

In `docs/HiFi-exegesis-nt-roadmap.md`, mark **Phase 5 fully done** (5a + 5b). Update the §B "query expansion" row to note domain-aware retrieval now exists (explicit-only).

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/
git commit -m "Document Phase 5b Louw-Nida domain search and retrieval"
```

---

## Task 10: Full verification gate + PR

- [ ] **Step 1: Verify (no concurrent DB processes — avoids the Windows prisma-generate EPERM)**

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run verify
```
Expected: lint + tsc + build + coverage all pass (exit 0). New pure helpers (`resolveDomainFilter`/`domainTokenWhere`/`detectDomainQuery`) are well covered; if branch coverage dips, add a targeted case for the `resolveDomainFilter` null path.

- [ ] **Step 2: Integration + acceptance**

```powershell
npm run test:integration
npm run test:acceptance
```
Expected: both exit 0. Acceptance corpus counts are unchanged (5b adds an index + read paths, no rows).

- [ ] **Step 3: Push + open PR**

Write the PR body to a temp file, then push and open the PR:
```powershell
@"
## Milestone 3 Phase 5b — Louw-Nida Domain Search & Retrieval

Adds a `domain` mode to ``/search`` (domain + subdomain dropdowns + free-text LN-reference field) and explicit ``domain N`` / ``LN 33.55`` retrieval in the assistant, backed by a new ``searchDomain`` helper over the Phase 5a token arrays and a new GIN index on ``Token.louwNida``.

### Included
- Schema: GIN index on ``Token.louwNida`` (migration ``20260607000000_louw_nida_search_index``).
- ``searchDomain`` (ln / subdomain / domain filters, precedence ln → subdomain → domain) + ``getLouwNidaDomainOptions``.
- ``/search`` domain mode: ``33 — Communication`` domain dropdown, dependent subdomain dropdown, LN-ref field; token results with matched Greek words highlighted.
- Assistant: explicit-only ``domainQuery`` signal (anchored — never trips on ``John 3.16``) + planner ``domainCall``.

### Testing
- Unit: domain-filter helpers, ``detectDomainQuery``, planner ``domainCall``.
- Integration: ln / subdomain / domain searches + 93 domain options against the test branch.
- ``npm run verify`` + ``test:integration`` + ``test:acceptance`` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"@ | Out-File -Encoding utf8 $env:TEMP\pr-body-5b.md
git push -u origin milestone-3/phase-5b-domain-search
gh pr create --base main --head milestone-3/phase-5b-domain-search --title "Milestone 3 Phase 5b — Louw-Nida domain search & retrieval" --body-file $env:TEMP\pr-body-5b.md
```
Per project practice: review Codex/Greptile PR comments and fix valid findings before merging.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 schema → Task 1; §2 `searchDomain` (three modes + precedence + expansion) → Tasks 2–3; §3 `/search` UI (display B, dependent subdomain, LN field, URL form) → Tasks 4–5; §4 assistant (explicit-only signal + `domainCall`) → Tasks 6–7; §5 testing → Tasks 2,6,7,8,10; §6 docs → Task 9. Inline highlighting falls out of token-based results (Task 3 returns `hydrateTokens` rows; Task 5 renders `kind: "token"`).
- **Type consistency:** `DomainFilter`/`resolveDomainFilter`/`domainTokenWhere` (Task 2) feed `searchDomain` (Task 3); `DomainOptions` (Task 3) is consumed by the page (Task 4) and `SearchPanel` (Task 5); `DomainQuerySignal`/`detectDomainQuery` (Task 6) feed `domainCall` (Task 7). `searchDomain` result fields (`tokenId/corpus/reference/surface/lemma/morphCode/verseText`) match what both `domainCall` and the page consume (same as `searchLemma` via `hydrateTokens`).
- **Codex review fixes folded in:** (1) the test branch gets the migration via the migration path (`migrate deploy` against `.env.test`) + `CREATE INDEX IF NOT EXISTS` + a `pg_indexes` presence assertion — no drift; (2) `selectedSubdomain` is controlled and cleared on domain change, and pagination links use the submitted props not live state; (3) the results-header label is derived from `domainOptions` via `domainSearchLabel`; (4) `domainCall` is added first in `buildPlan` so the 8-call cap can't drop explicit domain intent (locked by a crowded-plan test).
- **Out of scope (v1):** saving domain searches (Save button stays query-gated → hidden in domain mode); MARBLE subdomain codes / LN ranges in the subdomain dropdown; natural-language domain-name detection in the assistant.
