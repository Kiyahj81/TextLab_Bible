# English keyword stemming — design

**Date:** 2026-06-13
**Status:** Approved
**Context:** Closes the "English Snowball stemming deferred" follow-up tracked since
Milestone 3 Phase 3 (Lexical FTS). Today a `/search` keyword query for `love` matches
only the literal lexeme `love`; it misses `loves`, `loved`, `loving`. This design adds
Snowball stemming for English (WEB) keyword search so those inflections match, while
`beloved` (a distinct stem) correctly does not — and Greek (SBLGNT) keyword search is
left exactly as-is.

## Decisions (made with the maintainer)

- **Scope of effect:** both surfaces. `searchKeyword` feeds the `/search` UI *and* the
  assistant's retrieval planner, and stemming applies to both. This changes English
  keyword recall the planner sees, so eval-gate re-calibration is in scope.
- **Cross-corpus default:** per-row language routing. An unscoped keyword search still
  returns mixed SBLGNT + WEB rows; each row matches under its own language config
  (Greek via `bible_simple`, English via the new `bible_english`).
- **Stopwords:** stem **and** drop stopwords — the standard Postgres `english` behavior.
  A query consisting only of stopwords (`the`) yields an empty tsquery and 0 results,
  which is expected.
- **Architecture:** Approach A — a second generated tsvector column for the English
  config, leaving the existing Greek column and the citation spine untouched. (Rejected:
  a denormalized `lang` column + CASE-branched single column — more sync burden for no
  payoff at this corpus size; application-side JS stemming — reinvents Postgres FTS.)

## The problem in one paragraph

`Verse.text` holds both SBLGNT Greek rows and WEB English rows. A single stored
generated column `Verse.textSearch = to_tsvector('bible_simple', "text")` serves all
corpora, where `bible_simple` is `simple` + `unaccent` (lowercase + accent-fold, **no
stemming**). So `love` indexes as `love` and matches only `love`. Switching the config to
`english` globally is wrong: the Snowball stemmer would mangle Greek, and Greek
morphology is deliberately handled by the separate lemma-search layer, not keyword. The
fix must be English-only.

## Components

### 1. `bible_english` text-search configuration (immutable)

Mirror the `bible_simple` recipe (migration `20260530120000_lexical_fts`) but end the
mapping in the Snowball stemmer:

```sql
DROP TEXT SEARCH CONFIGURATION IF EXISTS bible_english;
CREATE TEXT SEARCH CONFIGURATION bible_english (COPY = english);
ALTER TEXT SEARCH CONFIGURATION bible_english
  ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword
  WITH unaccent, english_stem;
```

- `COPY = english` (not `simple`) preserves the English token mappings and the
  `english_stem` Snowball dictionary's built-in stopword handling (drops `the`, `of`,
  `and`, …).
- Injecting `unaccent` ahead of `english_stem` gives accent-folding and keeps the config
  **IMMUTABLE**, which a generated column requires. (A bare `unaccent()` call is not
  immutable; wiring it in as a dictionary is — the same reason `bible_simple` works.)
- `english_stem` ships with Postgres / is available on Neon; no new extension. `unaccent`
  already exists from the Phase 3 migration.

### 2. `Verse.textSearchEn` generated column + index (Approach A)

```sql
ALTER TABLE "Verse"
  ADD COLUMN "textSearchEn" tsvector
  GENERATED ALWAYS AS (to_tsvector('bible_english', "text")) STORED;
CREATE INDEX "Verse_textSearchEn_idx" ON "Verse" USING GIN ("textSearchEn");
```

- STORED backfills all rows (~16k) automatically on `ADD COLUMN`. The column is computed
  for **every** row regardless of corpus; routing (component 3) decides which rows are
  queried through it, so a Greek row's (meaningless) English vector is simply never the
  predicate used for that row.
- The existing `textSearch` (`bible_simple`) column is unchanged — the Greek path and the
  SBLGNT citation spine carry zero risk.
- Declared in `prisma/schema.prisma` as `textSearchEn Unsupported("tsvector")?` with a
  matching `@@index([textSearchEn], type: Gin)`, mirroring the existing `textSearch`
  declaration so Prisma drift detection accounts for it. Never read through the typed
  client.

**Migration delivery:** handwritten migration folder, applied with `npm run
db:migrate:deploy` to the dev (`ep-tiny-queen`) and test/eval (`ep-restless-union`) Neon
branches. This is the repo's standard for tsvector / immutable-config migrations
(`migrate dev` false-drifts on them, and `db:push` is intentionally disabled).

### 3. Language-routed querying in `searchKeyword` (`lib/search.ts`)

Routing keys off `Corpus.language` (confirmed values: `"Greek"`, `"English"`) — the
semantically correct discriminator, so any future English corpus routes correctly without
code changes.

- **Explicit `corpus=WEB`** (English): match `v."textSearchEn" @@
  websearch_to_tsquery('bible_english', q)`; rank mode ranks on `textSearchEn`.
- **Explicit Greek corpus** (`SBLGNT`): match `v."textSearch" @@
  websearch_to_tsquery('bible_simple', q)`; rank on `textSearch`. Unchanged from today.
- **Cross-corpus default** (no `corpus`, currently "any corpus except NET"): OR two
  language-scoped predicates so each row matches under its own config:

  ```sql
  -- Corpus is already joined as `c` in searchKeyword, so language is c."language".
  c."abbreviation" <> 'NET' AND (
    (c."language" = 'English'  AND v."textSearchEn" @@ websearch_to_tsquery('bible_english', q))
    OR
    (c."language" <> 'English' AND v."textSearch"   @@ websearch_to_tsquery('bible_simple',  q))
  )
  ```

  In rank mode the `ts_rank` expression is selected per row via a `CASE` on
  `c."language"`, picking the column/config that matched.

All user/assistant input stays bound as `Prisma.sql` parameters (query string, corpus,
book, chapter, offsets) — no string interpolation, so no new injection surface beyond the
existing parameterized `searchKeyword` raw-SQL row already in the security register.
`websearch_to_tsquery('bible_english', …)` tolerates arbitrary/hostile input exactly like
the `bible_simple` form, so there is no new throw surface.

The change is internal to `searchKeyword`'s SQL assembly; its TypeScript signature and
return shape are unchanged, so `/search`, the retrieval planner, and all callers are
untouched at the interface.

## Data flow (unchanged except the matched column)

`searchKeyword(input)` → build per-corpus predicate(s) → `$queryRaw` count + page rows →
`filterToSblSpine` annotates `onSpine` → optional `withEnglish` WEB batch-fetch →
results. Only the WHERE/ORDER predicates change; pagination, spine filtering, and the
`withEnglish` join are as-is.

## Error handling

- Empty query → existing early return (`{ results: [], total: 0 }`), unchanged.
- Stopword-only English query (`the`) → empty `bible_english` tsquery → 0 results. Expected
  and acceptable; documented in the `/search` no-results guidance copy if needed.
- Arbitrary/hostile input → `websearch_to_tsquery` never throws (both configs).

## Testing

The behavior lives in Postgres (stemming happens in the generated column / tsquery), so
the meaningful coverage is the real-DB integration suite.

- **`tests/integration/fts-search.test.ts`** (extend; requires the migration applied to
  the test branch):
  - `love` (WEB) returns strictly more hits than the pre-stemming baseline and includes a
    verse whose text has `loved`/`loving` but not the bare word `love` (e.g. a `loved`-only
    verse now surfaces).
  - `beloved` is **not** returned by a `love` search (distinct stem) — the precision guard.
  - Greek `λόγος` (SBLGNT) still matches whole-lexeme and the total is unchanged from today
    (proves the Greek path is untouched).
  - The existing `lov`→0 / `love`→>0 "whole lexemes not substrings" test still passes
    (`lov` is not a stem of `love`).
- **`tests/unit/lib/search-keyword.test.ts`** (mocked prisma): assert the routing logic —
  WEB input selects the `bible_english`/`textSearchEn` predicate, Greek input selects
  `bible_simple`/`textSearch`, and the no-corpus default emits both language-scoped
  branches.

## Calibration (the real cost, not optional)

Stemming raises English keyword recall, and keyword is a gated eval type, so:

1. **Eval gate.** Re-run `npm run eval:gate`. Per the project's eval philosophy, do **not**
   lower thresholds to pass — re-validate / re-scope the golden set if keyword items shift.
   Expect recall to rise; watch precision on keyword-typed golden questions.
2. **Acceptance test.** `scripts/acceptance-test.js` pins a **lemma** count
   (`40 results for lemma "λόγος" in John`), which stemming does not affect. Confirm during
   implementation that no keyword count is pinned; if one is added later, size it to the
   post-stemming total.

## Documentation

- `docs/PROJECT_STATE.md` — close the deferred stemming item (Phase 3 / Logical-next-steps
  notes); add the migration to the migrations list; update the snapshot line and the
  `/search` row's keyword description (English stems; Greek whole-lexeme).
- `README.md` — drop or update the "English Snowball stemming deferred" follow-up; refine
  the `/search` keyword-mode description.
- `docs/superpowers/specs/2026-05-30-lexical-fts-design.md` and the roadmap Phase 3 line —
  note the stemming follow-up landed.
- `docs/security-register.md` — no new entry (no new extension, no egress). Optionally note
  on the existing `searchKeyword` raw-SQL row that a second parameterized config/column was
  added, still injection-safe.

## Out of scope

- Lemma, morphology, domain, and semantic search modes — unchanged.
- The Greek (`bible_simple`) path and the SBLGNT citation spine — unchanged by construction.
- The grounding verifier and the prose-sweep follow-up — unrelated.
- Stem highlighting in result text (the UI highlights the literal query term; making the
  highlighter stem-aware is a separate, optional follow-up, not required for match
  correctness).

## Process

Single PR off `main` (branch `feat/english-keyword-stemming`): handwritten migration →
schema declaration → `searchKeyword` routing (TDD) → integration + unit tests → apply
migration to dev + test/eval branches → eval-gate re-validation → docs. `npm run verify`
plus `test:integration` green before push. Open the PR and **stop for maintainer review
and merge** (including Codex/CodeRabbit bot comments). Subagent-driven where tasks are
independent.
