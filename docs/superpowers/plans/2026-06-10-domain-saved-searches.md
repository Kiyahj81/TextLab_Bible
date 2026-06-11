# Domain Saved Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Louw-Nida domain searches saveable like the other three search modes — schema, API, client round-trip, and docs.

**Architecture:** A domain search's identity is `domain`/`subdomain`/`ln` (no query string), so `SavedSearch` gains three nullable columns and `query` becomes optional (one Prisma migration). The API enum gains `"domain"` with per-mode validation (`superRefine`): query modes require `query`; domain mode requires at least one domain field and no query. The client sends a friendly label it can already derive from `domainOptions`, removes the "can't be saved yet" gap, and the sidebar reconstructs domain URLs through the existing `searchHref` (which already accepts domain/subdomain/ln).

**Tech Stack:** Prisma 6 migration, zod 3 `superRefine`, Next.js App Router route handler, React client component, Vitest 4 (+ mocked-prisma route tests), real-Prisma integration suite against the `.env.test` Neon branch.

---

## Context an implementer must know

- **Current model** ([prisma/schema.prisma:136-152](../../prisma/schema.prisma#L136-L152)): `SavedSearch { id, userId, label, mode, query (REQUIRED), corpus?, book?, chapter?, matchMode?, createdAt, updatedAt }`.
- **Current API** ([app/api/saved-searches/route.ts](../../app/api/saved-searches/route.ts)): zod schema requires `query` min(1), `mode: z.enum(["keyword","lemma","morphology"])`, strips `matchMode` for non-morphology, derives `label` via `autoLabel` (`"lemma: λόγος (John 1)"` style) unless the client sends one (`label` is already an accepted optional field, max 100).
- **Current client** ([components/SearchPanel.tsx](../../components/SearchPanel.tsx)): `saveSearch` early-returns for domain mode (~line 176); the results header renders "Domain searches can&apos;t be saved yet." when `hasSearch && mode === "domain"`; the save block is gated on `{query ? ...}`. The sidebar maps `SavedSearchRow { id, label, mode, query, book, chapter, matchMode }` into `searchHref({...})` — `searchHref` ALREADY accepts optional `domain`/`subdomain`/`ln` and branches on `mode === "domain"` (it sets those instead of `q`). `domainOptions: DomainOptions` prop provides `{ domains: {code,number,label}[], subdomainsByDomain: Record<string, {code,label}[]> }` for friendly labels.
- **page.tsx** maps `prisma.savedSearch.findMany` rows to the `savedSearches` prop, listing each field explicitly — the three new columns must be added there.
- **Migration tooling**: `npm run db:migrate` hardcodes `--name init` — do NOT use it. Create the migration with `npx cross-env NODE_OPTIONS=--use-system-ca prisma migrate dev --name saved_search_domain_filters` (runs against the `.env` dev Neon branch; prisma.config.ts loads `.env` via dotenv). To apply it to the **test** branch (required before integration/acceptance on this feature), run migrate deploy with `.env.test` vars: `cross-env NODE_OPTIONS=--use-system-ca node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy` (node's `--env-file` sets vars first; prisma.config.ts's `dotenv/config` does not override already-set vars). Verify with the integration suite.
- **Eval CI**: `.github/workflows/eval-gate.yml` is read-only by design — it runs only `npm run eval:gate` and never deploys migrations. CI's database schema therefore depends entirely on Task 4's manual deploy. The maintainer confirmed (2026-06-11) that `EVAL_DATABASE_URL` points at the same seeded Neon test branch as `.env.test`, so that one deploy covers local integration/acceptance AND CI. The eval gate never queries `SavedSearch`, so schema lag would be non-fatal regardless.
- **Test conventions**: route tests ([tests/unit/api/saved-searches.test.ts](../../tests/unit/api/saved-searches.test.ts)) use `vi.hoisted` prismaMock + `requireAuthMock`, build a `Request` via local `jsonRequest`, and assert on `prismaMock.savedSearch.create.mock.calls[0][0]`. Component tests in `tests/unit/components/SearchPanel.test.tsx` (module-level `baseProps`, `domainOptions` fixture with domain `025` / subdomain `025001`; no jest-dom). Integration suite: `tests/integration/db-ownership.test.ts` runs real Prisma via `npm run test:integration`.
- **Windows/PowerShell**: never `&&`; chain with `;`. Commits via multiple `-m` flags. Single test file: `npx vitest run <path>`.
- **Commit style**: imperative subject; body ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File structure

| File | Change |
|---|---|
| `prisma/schema.prisma` + new `prisma/migrations/<ts>_saved_search_domain_filters/` | `query` optional; add `domain?`, `subdomain?`, `ln?` |
| `app/api/saved-searches/route.ts` | mode enum + domain fields + per-mode validation + domain auto-label |
| `components/SearchPanel.tsx` | domain save payload + button; sidebar domain links; `SavedSearchRow` fields |
| `app/search/page.tsx` | pass the three new columns through the savedSearches mapping |
| `tests/unit/api/saved-searches.test.ts` | domain validation/label cases |
| `tests/unit/components/SearchPanel.test.tsx` | domain save + sidebar round-trip cases |
| `tests/integration/db-ownership.test.ts` | one real-DB domain saved-search row |
| `README.md`, `docs/PROJECT_STATE.md` | drop the "domain searches can't be saved" caveat (holistic in-place edits per CLAUDE.md) |

---

### Task 0: Branch

- [ ] **Step 1: Confirm a clean worktree first.**

```powershell
git status --short
```

Expected: no output (the untracked plan file `docs/superpowers/plans/2026-06-10-domain-saved-searches.md` is the one allowed exception — commit it as the branch's first commit in Step 2). If ANY other uncommitted changes exist, STOP and report them instead of switching branches.

- [ ] **Step 2:**

```powershell
git checkout main; git pull; git checkout -b feat/domain-saved-searches
git add docs/superpowers/plans/2026-06-10-domain-saved-searches.md
git commit -m "Add domain saved-searches implementation plan" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 1: Schema migration

**Files:** Modify `prisma/schema.prisma`; generate `prisma/migrations/<timestamp>_saved_search_domain_filters/migration.sql`.

- [ ] **Step 1: Edit the model.** In `prisma/schema.prisma`, change the `SavedSearch` block to:

```prisma
model SavedSearch {
  id        String   @id @default(cuid())
  userId    String
  label     String
  mode      String
  query     String?
  corpus    String?
  book      String?
  chapter   Int?
  matchMode String?
  domain    String?
  subdomain String?
  ln        String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, updatedAt])
}
```

(Only `query` loses its required-ness and the three columns are added; everything else byte-identical.)

- [ ] **Step 2: Generate the migration** (against the `.env` dev branch):

Run: `npx cross-env NODE_OPTIONS=--use-system-ca prisma migrate dev --name saved_search_domain_filters`
Expected: a new folder under `prisma/migrations/` whose `migration.sql` contains exactly `ALTER TABLE "SavedSearch" ALTER COLUMN "query" DROP NOT NULL;` plus three `ADD COLUMN ... TEXT` statements. Inspect it; nothing else should appear (if drift is reported, STOP and report — do not reset anything).

- [ ] **Step 3: Absorb the nullability in the two type consumers** (the regenerated Prisma client makes `SavedSearch.query: string | null`, which breaks `app/search/page.tsx`'s mapping into `SavedSearchRow.query: string` — fix it NOW so this commit type-checks):
  - In `components/SearchPanel.tsx`, change the `SavedSearchRow` type's `query: string;` to `query: string | null;` and change the sidebar `searchHref` call's `query: item.query,` to `query: item.query ?? "",`.
  - No other client behavior changes in this task (the rest of the client work is Task 3).

- [ ] **Step 4: TypeScript check** — `npx tsc --noEmit --pretty false`. Must be clean now. Also run `npx vitest run tests/unit/components/SearchPanel.test.tsx` (existing fixtures pass string queries, which `string | null` accepts).

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations components/SearchPanel.tsx
git commit -m "Add domain filter columns to SavedSearch and make query optional" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: API — accept and label domain saved searches

**Files:** Modify `app/api/saved-searches/route.ts`; Test `tests/unit/api/saved-searches.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to the existing describe in `tests/unit/api/saved-searches.test.ts`:

```ts
  it("accepts a domain save with an ln reference and no query", async () => {
    const res = await POST(jsonRequest({ mode: "domain", ln: "33.55" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.mode).toBe("domain");
    expect(args.data.ln).toBe("33.55");
    expect(args.data.query).toBeNull();
  });

  it("accepts a domain save with a domain code and auto-labels from the filter", async () => {
    const res = await POST(jsonRequest({ mode: "domain", domain: "025" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("domain: 025");
  });

  it("prefers a client-supplied label for domain saves", async () => {
    await POST(jsonRequest({ mode: "domain", domain: "025", label: "domain: 25 — Attitudes and Emotions" }));
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.label).toBe("domain: 25 — Attitudes and Emotions");
  });

  it("rejects a domain save with no domain, subdomain, or ln", async () => {
    const res = await POST(jsonRequest({ mode: "domain" }));
    expect(res.status).toBe(400);
  });

  it("rejects a domain save that carries a query", async () => {
    const res = await POST(jsonRequest({ mode: "domain", ln: "33.55", query: "light" }));
    expect(res.status).toBe(400);
  });

  it("still rejects a query-mode save without a query", async () => {
    const res = await POST(jsonRequest({ mode: "lemma" }));
    expect(res.status).toBe(400);
  });

  it("ignores domain fields on query-mode saves", async () => {
    const res = await POST(jsonRequest({ mode: "lemma", query: "λόγος", domain: "025" }));
    expect(res.status).toBe(201);
    const args = prismaMock.savedSearch.create.mock.calls[0][0];
    expect(args.data.domain).toBeNull();
  });
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/api/saved-searches.test.ts` — new tests FAIL (mode enum rejects "domain").

- [ ] **Step 3: Implement.** In `app/api/saved-searches/route.ts`:

Add a cap constant next to the existing ones:

```ts
const MAX_DOMAIN_FIELD = 20;
```

Replace `savedSearchCreateSchema` with:

```ts
const savedSearchCreateSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY).optional(),
    mode: z.enum(["keyword", "lemma", "morphology", "domain"]).default("keyword"),
    matchMode: z.enum(["exact", "prefix"]).optional(),
    corpus: z.string().trim().max(MAX_CORPUS).optional(),
    book: z.string().trim().max(MAX_BOOK).optional(),
    chapter: z.coerce.number().int().positive().optional(),
    domain: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    subdomain: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    ln: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    label: z.string().trim().max(MAX_LABEL).optional()
  })
  .superRefine((value, ctx) => {
    if (value.mode === "domain") {
      if (!value.domain && !value.subdomain && !value.ln) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A domain saved search needs a domain, subdomain, or LN reference."
        });
      }
      if (value.query) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Domain saved searches do not take a query." });
      }
    } else if (!value.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Query is required." });
    }
  });
```

Replace `autoLabel` with a per-mode version (keep the existing query-mode strings byte-identical — five existing label tests pin them):

```ts
function autoLabel({
  mode,
  query,
  book,
  chapter,
  domain,
  subdomain,
  ln
}: {
  mode: string;
  query?: string;
  book?: string;
  chapter?: number;
  domain?: string;
  subdomain?: string;
  ln?: string;
}) {
  const subject = mode === "domain" ? (ln ?? subdomain ?? domain ?? "") : (query ?? "");
  if (!book) return `${mode}: ${subject}`;
  const scope = chapter ? `${bookName(book)} ${chapter}` : bookName(book);
  return `${mode}: ${subject} (${scope})`;
}
```

Update the POST body handling:

```ts
  const { query, mode, matchMode: rawMatchMode, corpus, book, chapter, domain, subdomain, ln, label: rawLabel } =
    valid.data;

  const isDomain = mode === "domain";
  const matchMode = mode === "morphology" ? rawMatchMode : undefined;
  const label =
    rawLabel || autoLabel({ mode, query, book, chapter, domain, subdomain, ln });

  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId,
      label,
      mode,
      query: isDomain ? null : (query ?? null),
      corpus,
      book,
      chapter,
      matchMode,
      domain: isDomain ? domain ?? null : null,
      subdomain: isDomain ? subdomain ?? null : null,
      ln: isDomain ? ln ?? null : null
    }
  });
```

- [ ] **Step 4:** Run the route test file — ALL tests pass (the five pre-existing label/matchMode/empty-query tests must pass unchanged; `prismaMock.savedSearch.create` echoes `data`, so `query: null` assertions work).

- [ ] **Step 5:** `npx tsc --noEmit --pretty false` and `npm run lint` — clean.

- [ ] **Step 6: Commit**

```powershell
git add app/api/saved-searches/route.ts tests/unit/api/saved-searches.test.ts
git commit -m "Accept domain saved searches in the saved-searches API" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Client — save, list, and round-trip domain searches

**Files:** Modify `components/SearchPanel.tsx`, `app/search/page.tsx`; Test `tests/unit/components/SearchPanel.test.tsx`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/components/SearchPanel.test.tsx`:

```tsx
describe("SearchPanel domain save", () => {
  it("saves an executed domain search with its filter fields and a friendly label", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            savedSearch: {
              id: "d1", label: "domain: 25 — Attitudes and Emotions", mode: "domain",
              query: null, book: null, chapter: null, matchMode: null,
              domain: "025", subdomain: null, ln: null
            }
          })
        };
      })
    );
    render(
      <SearchPanel {...baseProps} mode="domain" domain="025" hasSearch={true} searchLabel="Domain 25 — Attitudes and Emotions" />
    );
    fireEvent.click(screen.getByRole("button", { name: /save search/i }));
    await screen.findByText("Search saved.");
    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe("domain");
    expect(captured!.domain).toBe("025");
    expect(captured!.query).toBeUndefined();
    expect(captured!.label).toBe("domain: 25 — Attitudes and Emotions");
  });

  it("links a saved domain search back to a domain URL", () => {
    render(
      <SearchPanel
        {...baseProps}
        savedSearches={[
          { id: "d1", label: "domain: 25 — Attitudes and Emotions", mode: "domain", query: null,
            book: null, chapter: null, matchMode: null, domain: "025", subdomain: null, ln: null }
        ]}
      />
    );
    const link = screen.getByRole("link", { name: /domain: 25/i });
    expect(link.getAttribute("href")).toContain("mode=domain");
    expect(link.getAttribute("href")).toContain("domain=025");
    expect(link.getAttribute("href")).not.toContain("q=");
  });

  it("no longer claims domain searches cannot be saved", () => {
    render(<SearchPanel {...baseProps} mode="domain" domain="025" hasSearch={true} searchLabel="Domain 25" />);
    expect(screen.queryByText(/can't be saved yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /save search/i })).toBeTruthy();
  });
});
```

NOTE: the existing test `"explains that domain searches cannot be saved"` in the `"SearchPanel saved searches"` describe asserts the old copy — REWRITE it to assert the Save button instead (mirror the third test above), or delete it in favor of the new one (prefer rewrite-in-place with a comment-free change).

`SavedSearchRow` gains nullable fields, so existing fixtures with the old shape stay valid only if the new fields are optional — make them optional (`domain?: string | null` etc.) so no other test changes are needed.

- [ ] **Step 2:** Run the file — new tests FAIL.

- [ ] **Step 3: Implement in `components/SearchPanel.tsx`.**

(a) Extend the row type (`query` was already made nullable in Task 1; add only the three domain fields):

```ts
export type SavedSearchRow = {
  id: string;
  label: string;
  mode: string;
  query: string | null;
  book: string | null;
  chapter: number | null;
  matchMode: string | null;
  domain?: string | null;
  subdomain?: string | null;
  ln?: string | null;
};
```

(b) Add a friendly-label builder near `buildExampleSearches` (it has `domainOptions` in scope as a parameter):

```tsx
function domainSaveLabel(
  domainOptions: DomainOptions,
  filter: { domain: string; subdomain: string; ln: string }
): string {
  if (filter.ln) return `domain: LN ${filter.ln}`;
  if (filter.subdomain) {
    const parent = filter.subdomain.slice(0, 3);
    const sub = domainOptions.subdomainsByDomain[parent]?.find((s) => s.code === filter.subdomain);
    return sub ? `domain: ${sub.label}` : `domain: ${filter.subdomain}`;
  }
  const d = domainOptions.domains.find((entry) => entry.code === filter.domain);
  return d ? `domain: ${d.number} — ${d.label}` : `domain: ${filter.domain}`;
}
```

(c) In `saveSearch`, replace the domain early-return with a domain payload. The function currently starts with `if (!query.trim()) return;` — domain saves have no query, so restructure:

```ts
  async function saveSearch() {
    const executedMode = normalizeSearchMode(mode);
    const isDomain = executedMode === "domain";
    const hasDomainFilter = Boolean(domain || subdomain || ln);
    if (isDomain ? !hasDomainFilter : !query.trim()) return;
    if (saving) return;

    setSaving(true);
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isDomain
            ? {
                mode: executedMode,
                label: domainSaveLabel(domainOptions, { domain, subdomain, ln }),
                ...(domain ? { domain } : {}),
                ...(subdomain ? { subdomain } : {}),
                ...(ln ? { ln } : {}),
                ...(book ? { book } : {}),
                ...(chapter ? { chapter: Number(chapter) } : {})
              }
            : {
                mode: executedMode,
                query,
                // Omit empty optional fields — the server schema rejects empty
                // strings on coerced-number / enum fields (chapter, matchMode).
                ...(book ? { book } : {}),
                ...(chapter ? { chapter: Number(chapter) } : {}),
                ...(executedMode === "morphology" && matchMode ? { matchMode } : {})
              }
        )
      });
      /* rest unchanged */
```

(`domain`/`subdomain`/`ln` props are the SERVER-executed values, consistent with how query-mode saves use props.)

(d) Results header: replace the conditional save block. Currently `{query ? (<save row>) : hasSearch && mode === "domain" ? (<p>Domain searches can&apos;t be saved yet.</p>) : null}` becomes:

```tsx
{query || (hasSearch && mode === "domain" && (domain || subdomain || ln)) ? (
  /* existing save row (button + spacing) unchanged */
) : null}
```

(e) Sidebar link: add the domain fields to the `searchHref` call:

```tsx
href={searchHref({
  mode: item.mode,
  query: item.query ?? "",
  book: item.book ?? "",
  chapter: item.chapter ? String(item.chapter) : "",
  matchMode: item.matchMode ?? "exact",
  domain: item.domain ?? "",
  subdomain: item.subdomain ?? "",
  ln: item.ln ?? "",
  page: 1,
  pageSize
})}
```

(Verify `searchHref`'s domain branch only sets `domain`/`subdomain`/`ln` params when truthy — it does, via `if (domain) params.set(...)` etc.)

- [ ] **Step 4: page.tsx mapping.** In `app/search/page.tsx`, extend the savedSearches mapping with the three columns:

```tsx
savedSearches={savedSearches.map((item) => ({
  id: item.id,
  label: item.label,
  mode: item.mode,
  query: item.query,
  book: item.book,
  chapter: item.chapter,
  matchMode: item.matchMode,
  domain: item.domain,
  subdomain: item.subdomain,
  ln: item.ln
}))}
```

- [ ] **Step 5:** Run the SearchPanel test file (all green, including the rewritten domain-copy test), then `npx vitest run tests/unit`, `npx tsc --noEmit --pretty false`, `npm run lint`.

- [ ] **Step 6: Commit**

```powershell
git add components/SearchPanel.tsx app/search/page.tsx tests/unit/components/SearchPanel.test.tsx
git commit -m "Save and round-trip domain searches in the search UI" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Test database migration + integration coverage

- [ ] **Step 1: Apply the migration to the `.env.test` Neon branch:**

```powershell
npx cross-env NODE_OPTIONS=--use-system-ca node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
```

Expected: `1 migration applied` (saved_search_domain_filters). If this command shape fails, fall back to temporarily copying DATABASE_URL/DIRECT_URL from `.env.test` into the shell env and running `npm run db:migrate:deploy` — never edit `.env` itself.

- [ ] **Step 2: Add an integration case.** In `tests/integration/db-ownership.test.ts`, next to the existing saved-search scoping test, add (matching the file's existing user/cleanup fixtures — read them first):

```ts
  it("stores and scopes a domain saved search with null query", async () => {
    const row = await prisma.savedSearch.create({
      data: { userId: userA.id, label: "domain: LN 33.55", mode: "domain", query: null, ln: "33.55" }
    });
    const fetched = await prisma.savedSearch.findFirst({ where: { id: row.id, userId: userA.id } });
    expect(fetched?.ln).toBe("33.55");
    expect(fetched?.query).toBeNull();
    const crossUser = await prisma.savedSearch.findFirst({ where: { id: row.id, userId: userB.id } });
    expect(crossUser).toBeNull();
  });
```

(Adapt `userA`/`userB` to the file's actual fixture names; if its cleanup deletes by user cascade, no extra teardown is needed — verify.)

- [ ] **Step 3:** Run `npm run test:integration` — all green (proves the migration is live on the test branch).

- [ ] **Step 4: Eval DB schema note.** `.github/workflows/eval-gate.yml` is verified read-only — it runs only `npm run eval:gate` and never deploys migrations, so Step 1's deploy is the ONLY migration path for CI's database. **The maintainer confirmed (2026-06-11) that `EVAL_DATABASE_URL` points at the same Neon test branch as `.env.test`** — Step 1's deploy therefore covers CI as well. Nothing further to do beyond mentioning in the PR body that the shared test/eval branch already has the migration applied.

- [ ] **Step 5: Commit**

```powershell
git add tests/integration/db-ownership.test.ts
git commit -m "Cover domain saved searches in the DB integration suite" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Docs, verification, PR

- [ ] **Step 1: Docs (holistic, per CLAUDE.md).** Read README.md fully; wherever saved searches or the domain-save gap are described (Product Surface `/search` bullets), update in place so domain saving is simply part of the saved-search sentence — no changelog phrasing. In `docs/PROJECT_STATE.md`: the Phase 5b note "Saving domain searches is out of scope for v1" gets a follow-up sentence or in-place amendment noting it landed (reference this PR), and the `/search` runtime-surfaces row mention of saved searches is refreshed if it excludes domain. Re-read both documents after editing.

- [ ] **Step 2:** `npm run verify` (green) then `npm run test:acceptance` (green; the script's saved-search flow uses lemma mode and is unaffected — no assertion changes expected).

- [ ] **Step 3: Push + PR** (hold the merge for the user; do not poll bot reviews):

```powershell
git push -u origin feat/domain-saved-searches
gh pr create --title "Make domain searches saveable" --body-file <body file describing schema migration, API validation, client round-trip, test-branch migration note>
```

PR body must call out the schema migration explicitly (reviewers should see it first) and note that the `.env.test` Neon branch already has it applied.

---

## Out of scope

- Editing a saved search's filters (rename-only PATCH stays as is).
- Saving the English-toggle state or page size with a search.
- Acceptance-script coverage of the domain-save flow (unit + integration cover it; add to the script only if a regression ever slips through).
