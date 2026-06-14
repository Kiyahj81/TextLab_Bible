# English keyword stemming — design

**Date:** 2026-06-13
**Status:** Approved
**Context:** Closes the "English Snowball stemming deferred" follow-up tracked since
Milestone 3 Phase 3 (Lexical FTS). Today a `/search` keyword query for `love` matches
only the literal lexeme `love`; it misses `loves`, `loved`, `loving`. This design adds
Snowball stemming for English (WEB) keyword search so those inflections match, while
`beloved` (a distinct stem) correctly does not, and makes result highlighting track the
stemmer so matched inflections are actually marked. Greek (SBLGNT) keyword
matching/ranking is left exactly as-is (its highlighting gains an incidental accent fix —
component 4).

## Decisions (made with the maintainer)

- **Scope of effect:** every place English keyword matching happens. `searchKeyword` feeds
  the `/search` UI *and* the assistant's deterministic retrieval planner. The assistant's
  semantic-hybrid path (`searchSemantic`) has its **own** WEB-only FTS leg — a separate
  inline `$queryRaw`, **not** routed through `searchKeyword` — and it is stemmed too
  (component 5), so English keyword matching is consistent everywhere it runs. This changes
  English keyword recall, so an eval **regression** pass is in scope (note: keyword is *not*
  a gated eval type — see Calibration).
- **Cross-corpus default:** per-row language routing. An unscoped keyword search still
  returns mixed SBLGNT + WEB rows; each row matches under its own language config
  (Greek via `bible_simple`, English via the new `bible_english`).
- **Stopwords:** stem **and** drop stopwords — the standard Postgres `english` behavior.
  A query consisting only of stopwords (`the`) yields an empty tsquery and 0 results,
  which is expected.

  > **Update 2026-06-13:** This decision was **reversed** by migration `20260613130000_english_stem_no_stopwords`. The `bible_english` config now uses a custom Snowball dictionary `english_stem_nostop` (no stopword list), so every word — including `just`, `no`, `own`, `all`, `before`, etc. — is indexed and matched. A stopword-only query (`the`) now returns the whole (paginated) corpus instead of 0 results; this is acceptable for a literal keyword search box. Stopword filtering lives exclusively in the Assistant layer (`lib/ai/signals.ts` `STOP_WORDS`, applied in `detectTopicWords` before constructing retrieval plans); the FTS config no longer drops any words. Four words were also removed from `STOP_WORDS` — `just`, `give`, `form`, `forms` — so the assistant can surface verses about God being *just*, the topic of *giving*, and Christ being *formed* in us.
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

A **single** language-routed match predicate is used for **every** call — whether or not a
corpus is given — because each row can only match under its own language branch, and the
existing corpus filter narrows which rows are eligible:

```sql
-- Corpus is already joined as `c` in searchKeyword, so language is c."language".
(
  (c."language" = 'English'  AND v."textSearchEn" @@ websearch_to_tsquery('bible_english', q))
  OR
  (c."language" <> 'English' AND v."textSearch"   @@ websearch_to_tsquery('bible_simple',  q))
)
```

combined with the unchanged corpus filter (`c."abbreviation" = <corpus>` when one is given,
else `c."abbreviation" <> 'NET'`). This is **equivalent** to branching the predicate on the
requested corpus, but simpler (one predicate, no `input.corpus` conditional):

- `corpus=WEB` → the corpus filter keeps only English rows, which match via the
  `bible_english`/`textSearchEn` branch; the Greek branch never matches a WEB row.
- `corpus=SBLGNT` → only Greek rows, matched via `bible_simple`/`textSearch` (unchanged from
  today).
- no `corpus` → both branches apply per row across the mixed result set.

The unused branch's `websearch_to_tsquery` is still parsed by Postgres on a single-corpus
call, but at NT-corpus scale that is negligible. In rank mode the `ts_rank` expression is
selected per row via a `CASE` on `c."language"`, picking the column/config that matched.

All user/assistant input stays bound as `Prisma.sql` parameters (query string, corpus,
book, chapter, offsets) — no string interpolation, so no new injection surface beyond the
existing parameterized `searchKeyword` raw-SQL row already in the security register.
`websearch_to_tsquery('bible_english', …)` tolerates arbitrary/hostile input exactly like
the `bible_simple` form, so there is no new throw surface.

The matching/ranking change is internal to `searchKeyword`'s SQL assembly. The result
shape gains one **additive, optional** field for highlighting (component 4); the retrieval
planner and other callers ignore it, so they are untouched.

### 4. Stem-aware result highlighting via `ts_headline`

**Why this is in scope.** The result highlighter (`lib/search-highlight.ts`
`splitWithMatches`) does a literal case-insensitive **substring** match of the raw query
against the verse text — it does not know stemming happened. So a `love` query highlights
`love` and the `love` inside `loved`/`loves`, but a correctly-matched `loving` verse
(`love` is not a substring of `loving`) shows **no** highlight, and a `loved` query returns
`love`/`loving` verses with nothing marked at all. Matching would be correct while
highlighting silently disagrees — a "matched but nothing highlighted" look that reads as a
bug. Letting Postgres mark the matches with the **same** config that found them keeps the
two in lockstep.

**Mechanism.** In keyword mode, the row SELECT computes a headline with the row's language
config, using the same bound tsquery as the predicate:

```sql
ts_headline(
  <config>, v."text", websearch_to_tsquery(<config>, q),
  'HighlightAll=true, StartSel=<S>, StopSel=<E>'
)
```

where `<config>` is `bible_english` for English rows and `bible_simple` for Greek rows
(per-row `CASE` on `c."language"`, mirroring the predicate routing). `HighlightAll=true`
returns the **whole verse** (not a truncated snippet). `<S>`/`<E>` are sentinel delimiters
from the Unicode Private-Use Area (e.g. `U+E000`/`U+E001`) that cannot occur in WEB or
SBLGNT text, so parsing is unambiguous. `searchKeyword` splits the headline on the
sentinels into the existing `HighlightSegment[]` shape (`{ kind: "text" | "match", value }`)
and returns it as an optional `highlightSegments` field on each keyword result. The headline
text/config are bound parameters; the options string is a literal — no new injection surface.

**Bonus fix.** Routing Greek keyword highlighting through `ts_headline('bible_simple', …)`
also corrects a latent accent bug: today an unaccented Greek query (`λογος`) matches the
accented text (`λόγος`) but `splitWithMatches` finds no literal substring and highlights
nothing. `ts_headline` with the unaccent-aware config marks it correctly.

**Client.** `SearchPanel`'s keyword result row renders `highlightSegments` directly when
present (each `match` segment wrapped in `<mark>`), falling back to the existing
`<HighlightedText text match={query} />` when absent. Lemma mode is unchanged — it
highlights the exact matched token `surface` via `splitWithMatches`, which is correct and
needs no stemming.

### 5. Stem the assistant's semantic FTS leg (`searchSemantic` in `lib/search.ts`)

The assistant's hybrid retrieval (`searchSemantic`) fuses pgvector KNN with a keyword FTS
leg via Reciprocal Rank Fusion. That FTS leg is a **separate inline `$queryRaw`** (it does
not call `searchKeyword`) and today uses `websearch_to_tsquery('bible_simple', keywords)`
against `v."textSearch"`. Because the semantic index is WEB-only
(`SEMANTIC_INDEX_CORPUS = "WEB"`), this leg is **always English**, so it is switched
unconditionally to `bible_english`/`textSearchEn` — both the `@@` predicate and the
`ts_rank` ordering. No language routing is needed (the corpus is fixed). This keeps the
assistant's two English keyword legs (deterministic `searchKeyword` and semantic FTS)
consistently stemmed; leaving it on `bible_simple` would mean conceptual prompts retrieve
unstemmed while keyword prompts retrieve stemmed.

This is the only change to `searchSemantic`; the vector leg, RRF, SBL-spine filter, and
rerank are untouched. The conceptual eval type (which exercises this path) is **report-only**
(weekly hybrid report), so this does not touch the deterministic gate.

## Data flow

`searchKeyword(input)` → build per-corpus predicate(s) + per-row `ts_headline` (keyword
mode) → `$queryRaw` count + page rows → `filterToSblSpine` annotates `onSpine` → parse each
headline into `highlightSegments` → optional `withEnglish` WEB batch-fetch → results. The
WHERE/ORDER predicates and the new headline column change; pagination, spine filtering, and
the `withEnglish` join are as-is.

## Error handling

- Empty query → existing early return (`{ results: [], total: 0 }`), unchanged.
- Stopword-only English query (`the`) → empty `bible_english` tsquery → 0 results. Expected
  and acceptable; documented in the `/search` no-results guidance copy if needed.

  > **Update 2026-06-13:** With `english_stem_nostop`, a stopword-only query (`the`) no longer produces an empty tsquery. It now matches every English row and returns the whole (paginated) corpus. This is the intended behavior for a literal keyword search box.
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
  - **Highlight coverage:** a `love` (WEB) search returns a `loving` verse whose
    `highlightSegments` contains a `match` segment (the stemmer-found word is marked, not
    left plain) — the case the old substring highlighter missed.
- **`tests/unit/lib/search-keyword.test.ts`** (mocked prisma): assert the assembled SQL
  carries the unified predicate (`bible_english`, `textSearchEn`, `bible_simple`, and
  `"language"` all present) and that an explicit `corpus` narrows via the abbreviation filter;
  assert the per-row `headline` is parsed into `highlightSegments`.
- **`tests/unit/lib/search-semantic.test.ts`** (extend): assert the FTS leg's SQL uses
  `bible_english`/`textSearchEn` (not `bible_simple`/`textSearch`), preserving the existing
  no-key / disabled behavior.
- **`tests/unit/lib/search-highlight.test.ts`** (or alongside): unit-test the headline →
  `HighlightSegment[]` sentinel parser (matched span, leading/trailing text, adjacent
  matches, no-match passthrough). Pure string logic, no DB.

## Calibration and verification

**There is no keyword eval gate.** The eval golden set is typed by `exact-verse`,
`lemma-survey`, `conceptual`, `domain`, `cross-chapter` (`eval/dataset/schema.ts`) — there is
**no** `keyword` query type, and `eval/thresholds.ts` has no keyword gate. So `eval:gate`
cannot, and is not expected to, "prove" stemming. Proof of the stemming behavior comes from
the **integration tests** (below), which assert it directly against the real corpus.

What `eval:gate` does here is guard against **regressions**:

1. **Eval gate as a regression guard.** Re-run `npm run eval:gate`. Stemming changes English
   keyword recall, which can perturb any **gated** item whose retrieval plan includes a
   keyword call — most plausibly precision on `exact-verse`/`cross-chapter` (gated at 1.0) or
   the two global hard gates (citation resolvability, lemma coverage, both 100%). If a gated
   item regresses, fix the **golden set / measurement**, not the thresholds (project eval
   philosophy): extend the expected set when stemming surfaces additional *correct* verses, or
   tighten the query/scope when it surfaces *off-target* ones. The `conceptual` type (which
   exercises the now-stemmed semantic FTS leg) is **report-only**, so it is observed in the
   weekly hybrid report, not the gate.
2. **Integration tests are the proof.** See Testing — `love`→`loved`/`loving`, `beloved`
   excluded, highlight coverage, Greek invariant.
3. **Acceptance test.** `scripts/acceptance-test.js` pins a **lemma** count
   (`40 results for lemma "λόγος" in John`), which stemming does not affect, and asserts no
   keyword count. Confirm it still passes; if a keyword count is added later, size it to the
   post-stemming total.

A dedicated `keyword` eval query type (with curated goldens and calibrated thresholds) is a
reasonable **future** enhancement, but it is its own eval-expansion task and is out of scope
here.

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

- Lemma, morphology, and domain search modes — unchanged.
- Semantic search's **vector / RRF / rerank** behavior — unchanged. Only its keyword FTS leg's
  config changes (`bible_simple` → `bible_english`, component 5); the vector KNN, fusion,
  SBL-spine filter, and Voyage rerank are untouched.
- The Greek (`bible_simple`) matching/ranking path and the SBLGNT citation spine — unchanged
  by construction (Greek highlighting routes through `ts_headline('bible_simple', …)`, an
  incidental improvement, not a matching change).
- The grounding verifier and the prose-sweep follow-up — unrelated.
- Lemma-mode highlighting — already exact (matched token `surface`); unchanged.

## Process

Single PR off `main` (branch `feat/english-keyword-stemming`): handwritten migration →
schema declaration → headline sentinel parser → `searchKeyword` predicate routing +
`ts_headline` and `searchSemantic` FTS-leg stemming (TDD) → `SearchPanel` segment rendering
→ apply migration to dev + test/eval branches → integration + unit tests → eval regression
pass → docs. `npm run verify` plus `test:integration` green before push. Open the PR and
**stop for maintainer review and merge** (including Codex/CodeRabbit bot comments).
Subagent-driven where tasks are independent.
