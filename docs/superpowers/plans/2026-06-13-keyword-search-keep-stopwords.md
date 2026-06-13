# Keyword Search: Keep Stopwords (search anything) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/search` keyword mode match *any* word the user types — including words the standard English stopword list drops (`just`, `no`, `own`, `all`, `before`…) — while keeping Snowball stemming, and let the Assistant surface `just`/`give`/`form` topics by removing those four words from its app-level `STOP_WORDS`.

**Architecture:** Two complementary changes shipped together. (1) Swap the Postgres `bible_english` config's built-in `english_stem` dictionary (which bundles the english stopword list) for a custom Snowball dictionary `english_stem_nostop` (same stemming, **no** stopword dropping), then rebuild the `Verse.textSearchEn` generated column so stored vectors keep every word. The search box becomes WYSIWYG; stopword filtering now lives **only** where it belongs — the Assistant's `lib/ai/signals.ts` `STOP_WORDS` (used by `detectTopicWords` → `keywords` before the FTS query). (2) Remove `just`/`give`/`form`/`forms` from that `STOP_WORDS` set so the Assistant's topic extraction passes them through (already edited in the working tree). The two changes are synergistic: the Assistant can only retrieve "just" verses if both its keyword survives extraction *and* the FTS config matches the word.

**Tech Stack:** Postgres FTS (`tsvector`, custom `TEXT SEARCH DICTIONARY` snowball, generated columns, GIN), Prisma 6 raw SQL + `migrate deploy`, Vitest 4, Neon branches.

**Spec source:** This plan; design agreed in-session. Supersedes the "stem AND drop stopwords" decision in `docs/superpowers/specs/2026-06-13-english-keyword-stemming-design.md`.

**Process rules:**
- Single PR on branch `feat/keyword-search-keep-stopwords` (already checked out; the `signals.ts` edit is already in the working tree, uncommitted — Task 3 commits it with tests).
- Never run `prisma migrate dev` (autocrlf false-drift). Handwritten migration applied with `migrate deploy`. CA-wrapped scripts (`db:migrate:deploy`, `db:migrate:deploy:test`, `prisma:migrate:status`) already exist from the prior PR.
- `npm run verify` green before push. After opening the PR, **stop and wait** for maintainer review/merge (including Codex/CodeRabbit comments).

---

### Task 1: Migration — `english_stem_nostop` dictionary + rebuild `textSearchEn`

**Files:**
- Create: `prisma/migrations/20260613130000_english_stem_no_stopwords/migration.sql`

- [ ] **Step 1: Confirm branch**

Run: `git branch --show-current`
Expected: `feat/keyword-search-keep-stopwords`.

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260613130000_english_stem_no_stopwords/migration.sql`:

```sql
-- Make English keyword search match EVERY word, including ones the standard
-- `english` stopword list drops (`just`, `no`, `own`, `all`, `before`, ...).
-- The /search keyword box is WYSIWYG: a user who types a word wants verses that
-- contain it. Stopword filtering for the natural-language Assistant lives in the
-- app layer (lib/ai/signals.ts STOP_WORDS -> detectTopicWords), NOT in this shared
-- FTS config, so dropping stopwords here was redundant for the Assistant and broke
-- the search box as a side effect.
--
-- Swap the built-in `english_stem` dictionary (Snowball + StopWords = english) for
-- a custom Snowball dictionary with NO stopword list. Stemming is unchanged
-- (loved -> love); only stopword dropping is removed.

-- 1. Snowball stemmer without a stopword list. The snowball template is IMMUTABLE,
--    so to_tsvector('bible_english', text) stays IMMUTABLE (required by the
--    STORED generated column).
CREATE TEXT SEARCH DICTIONARY english_stem_nostop (
  TEMPLATE = snowball,
  Language = english
);

-- 2. Re-point bible_english's word-token mapping at the no-stopword stemmer.
--    Same token list and unaccent prefix as 20260613120000_english_stem_fts.
ALTER TEXT SEARCH CONFIGURATION bible_english
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, english_stem_nostop;

-- 3. Rebuild Verse.textSearchEn. Changing the config does NOT recompute a STORED
--    generated column, so drop and re-add it: the re-add recomputes every row with
--    the new mapping. The whole file runs in one transaction (all-DDL), so readers
--    never see a missing column. ~16k rows; sub-second ACCESS EXCLUSIVE lock.
DROP INDEX IF EXISTS "Verse_textSearchEn_idx";
ALTER TABLE "Verse" DROP COLUMN "textSearchEn";
ALTER TABLE "Verse"
  ADD COLUMN "textSearchEn" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_english', "text")) STORED;
CREATE INDEX "Verse_textSearchEn_idx" ON "Verse" USING GIN ("textSearchEn");
```

> The column name, type, and generated expression are unchanged, so `prisma/schema.prisma` needs **no** edit and drift stays clean.

- [ ] **Step 3: Apply to the dev/prod Neon branch**

Run: `npm run db:migrate:deploy`
Expected: `20260613130000_english_stem_no_stopwords` applied; `All migrations have been successfully applied.`

- [ ] **Step 4: Verify status clean**

Run: `npm run prisma:migrate:status`
Expected: lists `20260613130000_english_stem_no_stopwords` among applied; ends `Database schema is up to date!` (no drift — schema.prisma unchanged and the column still matches).

- [ ] **Step 5: Smoke-check the config (optional, if a SQL console is handy)**

```sql
SELECT to_tsvector('bible_english', 'just loved loving');
```
Expected: `just` is now KEPT (its own lexeme) AND `loved`/`loving` still collapse to `love` — proving stopwords kept + stemming intact. If you only have `prisma db execute` (no row output), skip; behavior is proven in Task 2.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260613130000_english_stem_no_stopwords/migration.sql
git commit -m "Keep stopwords in bible_english FTS config (search anything, still stems)"
```

### Task 2: Apply migration to test/eval branch + integration coverage

**Files:**
- Modify: `tests/integration/fts-search.test.ts`

- [ ] **Step 1: Apply the migration to the test/eval Neon branch**

Run: `npm run db:migrate:deploy:test`
Expected: `20260613130000_english_stem_no_stopwords` applied; `All migrations have been successfully applied.` This branch backs `test:integration` and the eval gate, so the rebuilt column must exist here before either runs.

- [ ] **Step 2: Add the integration case**

Add to `tests/integration/fts-search.test.ts` inside the `describe.skipIf(!enabled)("FTS keyword search", …)` block:

```typescript
  it("matches words the english stop list used to drop (just / no / own)", async () => {
    // These return 0 under the stopword-dropping `english` config; with
    // english_stem_nostop they are indexed and searchable.
    for (const term of ["just", "no", "own"]) {
      const out = await searchKeyword({ query: term, corpus: "WEB", pageSize: 1 });
      expect(out.pagination.total, `expected WEB matches for "${term}"`).toBeGreaterThan(0);
    }
  });

  it("still stems while keeping stopwords (a 'love' search includes 'loved')", async () => {
    const love = await searchKeyword({ query: "love", corpus: "WEB", pageSize: 100 });
    expect(love.results.map((r) => r.reference)).toContain("John 3:16");
  });
```

> The pre-existing Greek-invariance case (`λόγος` matches, `λογ` → 0) and the existing
> `love`→`loved` / `beloved`-excluded cases remain valid and act as further guards;
> do not modify them. There is no pre-existing test asserting a stopword query returns
> 0, so nothing needs updating — but if you find one, it is now stale (a stopword like
> `the` now returns the whole corpus, which is expected) and should be removed or
> retargeted, with a note in the report.

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS for the FTS keyword cases (new + pre-existing). Note any **unrelated** pre-existing failures (e.g. the live-gateway `rerankCandidates` test in `semantic-search.test.ts`) in your report but do not treat them as this task's regressions — confirm the FTS keyword cases themselves ran (not skipped) and passed.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/fts-search.test.ts
git commit -m "Add integration coverage for searchable former-stopwords"
```

### Task 3: Assistant `STOP_WORDS` — keep `just`/`give`/`form`/`forms`

**Files:**
- Modify: `lib/ai/signals.ts` (the `STOP_WORDS` set — **edit already present in the working tree, uncommitted**)
- Modify: `tests/unit/lib/ai/signals.test.ts`

- [ ] **Step 1: Verify the working-tree edit is exactly the intended four-word removal**

Run: `git diff lib/ai/signals.ts`
Expected: the only change is removing `"give"`, `"just"`, `"form"`, `"forms"` from the `STOP_WORDS` `Set` (no other tokens added/removed, no logic change). If the diff shows anything else, STOP and report — do not "fix" it silently.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/lib/ai/signals.test.ts` inside the `describe("detectTopicWords", …)` block:

```typescript
  it("keeps just/give/form/forms now that they are off the stop list", () => {
    // Removed from STOP_WORDS so the Assistant can surface verses about God being
    // just, the topic of giving, and Christ being "formed" in us.
    expect(detectTopicWords("verses about God being just")).toContain("just");
    expect(detectTopicWords("give")).toEqual(["give"]);
    expect(detectTopicWords("form")).toEqual(["form"]);
    expect(detectTopicWords("forms")).toEqual(["forms"]);
  });
```

- [ ] **Step 3: Run the new test + the whole signals suite**

Run: `npx vitest run tests/unit/lib/ai/signals.test.ts`
Expected: the new test PASSES (the edit is already in place), and **all** pre-existing signals tests still pass. If any pre-existing test now fails because it assumed one of these four words was a stopword, that test encoded the old behavior — update its expectation to match the intended new behavior and note the change in your report. (The `ENGLISH_TO_GREEK_LEMMA` "every key reachable" test at ~line 166 only checks reachability, so removing stopwords cannot break it.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 5: Commit (the signals edit + its test together)**

```bash
git add lib/ai/signals.ts tests/unit/lib/ai/signals.test.ts
git commit -m "Drop just/give/form/forms from Assistant STOP_WORDS so those topics surface"
```

### Task 4: Eval-gate regression + acceptance

**Files:**
- Possibly modify: `eval/dataset/golden-set.json` (ONLY if a *gated* item legitimately shifts)

- [ ] **Step 1: Run the deterministic eval gate**

Run: `npm run eval:gate`
Expected: `Eval gate passed.` This is a regression guard for BOTH changes: keeping stopwords changes English keyword recall, and removing the four `STOP_WORDS` changes the Assistant's topic extraction (which feeds gated items whose plan includes keyword/semantic calls). Gated types: exact-verse + cross-chapter (recall+precision = 1.0), lemma-survey (recall = 1.0), plus the two global hard gates (citation resolvability, lemma coverage = 100%). `conceptual`/`domain` are report-only.

- [ ] **Step 2: If a GATED item regresses, fix the measurement — not the threshold**

If the gate flags a gated item: inspect it in `eval/dataset/golden-set.json`. If the change surfaced additional **correct** verses, extend the item's `goldenReferences`; if **off-target**, tighten the query/scope. **Do NOT lower thresholds** in `eval/thresholds.ts`. Re-run `npm run eval:gate` until green. If a failure is NOT plausibly caused by either change, STOP and report rather than editing the golden set.

- [ ] **Step 3: Acceptance**

Run: `npm run test:acceptance`
Expected: `"passed": true`. The pinned `λόγος` lemma count (40) is Greek-side and unaffected by either change. (Neon test endpoint can cold-start; if the first run times out on the TCP preflight, re-run once.)

- [ ] **Step 4: Commit any golden-set change (skip if none)**

```bash
git add eval/dataset/golden-set.json
git commit -m "Rescope gated golden item(s) for kept-stopword recall"
```

### Task 5: Documentation + security register

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `README.md`, `docs/superpowers/specs/2026-06-13-english-keyword-stemming-design.md`, `docs/security-register.md`

- [ ] **Step 1: PROJECT_STATE — record the migration + correct the keyword description**

- Add to the migrations list (after `20260613120000_english_stem_fts`, ~line 158):
  ```markdown
  - `20260613130000_english_stem_no_stopwords` — swaps `bible_english`'s `english_stem` dictionary for a custom Snowball dictionary `english_stem_nostop` (no stopword list) and rebuilds `Verse.textSearchEn` + its GIN index. English keyword search now matches every word (e.g. `just`, `no`, `own`), still stemmed; stopword filtering moves entirely to the Assistant's `STOP_WORDS` (handwritten; applied via `migrate deploy` to the dev/prod and test/eval Neon branches).
  ```
- Update the `/search` keyword row / snapshot wording: keyword mode now matches **any** word (no stopword dropping), still stems English (WEB) and keeps Greek whole-lexeme.

- [ ] **Step 2: README — `/search` description**

In the `/search` keyword-mode description, drop any "drops stopwords" implication: keyword mode matches any typed word, stems English, keeps Greek whole-lexeme.

- [ ] **Step 3: Stemming spec — supersede the Stopwords decision**

In `docs/superpowers/specs/2026-06-13-english-keyword-stemming-design.md`, add a dated `> Update 2026-06-13:` note at the **Stopwords** decision (and/or Error-handling line that says a stopword-only query yields 0): the "stem AND drop stopwords" choice was reversed — `bible_english` now uses `english_stem_nostop` (keeps all words); stopword filtering lives solely in the Assistant's `STOP_WORDS`. A stopword-only query (`the`) now returns the whole (paginated) corpus, which is acceptable for a literal keyword box.

- [ ] **Step 4: Security register — update the searchKeyword row**

In `docs/security-register.md`, on the `Phase 3 raw SQL surface in searchKeyword` row, note that `bible_english` now maps through the custom `english_stem_nostop` Snowball dictionary (still IMMUTABLE; still all values bound; no new injection surface, no new extension/egress).

- [ ] **Step 5: Commit**

```bash
git add docs/PROJECT_STATE.md README.md docs/superpowers/specs/2026-06-13-english-keyword-stemming-design.md docs/security-register.md
git commit -m "Document kept-stopword keyword search and STOP_WORDS adjustment"
```

### Task 6: Verify, push, open PR, stop

- [ ] **Step 1:** Run `npm run verify` — exit 0 (lint + tsc + build + coverage gate).
- [ ] **Step 2:** Confirm the FTS keyword integration cases pass (from Task 2; the unrelated live-gateway rerank failure, if present, is pre-existing and environmental — note it, don't block on it).
- [ ] **Step 3:** Push: `git push -u origin feat/keyword-search-keep-stopwords`
- [ ] **Step 4:** Open the PR (title: "Keyword search matches any word (keep stopwords) + Assistant STOP_WORDS tweak"). Body: summarize the `english_stem_nostop` migration + column rebuild, the `STOP_WORDS` four-word removal and why (just/give/form/forms), tests, eval/acceptance results, that the migration is already applied to both Neon branches, and that stopword filtering now lives only in the Assistant layer.
- [ ] **Step 5:** **Stop. Report to the maintainer and wait for review/merge** (including Codex/CodeRabbit). The `Eval Gate / gate` check must pass on the PR.

---

## Notes for the implementer

- **Both changes belong together.** The migration lets the FTS config match `just`; the `STOP_WORDS` edit lets the Assistant's extraction *pass* `just`/`give`/`form`/`forms` through to that match. One without the other is half a feature.
- **Migration is shared infra.** ep-tiny-queen backs dev + prod; ep-restless-union backs integration + eval. Tasks 1 and 2 apply to both. Never `prisma migrate dev`.
- **The column rebuild is a drop/re-add inside one transaction** — atomic, no missing-column window, sub-second at NT scale. Do not try to "recompute in place"; a STORED generated column only recomputes on row write, and Postgres can't re-add a GENERATED expression to an existing column.
- **Keyword is not a gated eval type.** `eval:gate` here is a regression guard; the integration tests (Task 2) are the proof for the search side, and the signals unit test (Task 3) is the proof for the Assistant side.
