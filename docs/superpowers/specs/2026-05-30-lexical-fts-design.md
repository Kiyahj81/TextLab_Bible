# Phase 3 — Lexical FTS (tsvector + GIN, ranked keyword search)

*Status:* Design approved 2026-05-30 · *Milestone:* 3, Phase 3 · *Predecessors:* Phase 1
(deterministic planner) and Phase 2 (Grounding + Silence Protocol), both shipped on `main`.

## Purpose

Replace the `ILIKE '%query%'` substring match in `searchKeyword` (`lib/search.ts`) with PostgreSQL
full-text search: a `tsvector` generated column on `Verse.text`, a GIN index, and ranked matching via
`ts_rank`. This is the **lexical half of the architecture doc's hybrid retrieval pipeline** (FTS now;
pgvector + RRF + rerank later in Phase 4) and it also upgrades the standalone search UI.

Phase 3 delivers three capabilities at once (chosen over a narrower scope):
1. **Lexeme-aware matching** — whole-word matching instead of accidental substring fragments.
2. **Accent folding** — Greek `λογος` finds accented `λόγος`; the authoritative SBLGNT spine becomes
   accent-insensitive.
3. **Relevance ranking** — `ts_rank` so the strongest verses can surface first.

## Scope decision — multilingual FTS (LOCKED)

`Verse.text` holds **both** SBLGNT (Greek) and WEB (English) rows in one column; corpus identity lives
in a separate `Corpus` table keyed by cuid (not denormalized onto `Verse`). That constraint drives the
config choice, because a Postgres **generated column cannot reference another table** and its
expression must be **IMMUTABLE**.

**Chosen: Option A — one unified accent-folded `simple` config applied to every row.**

- A custom text-search config (`bible_simple`) clones `simple` and wires `unaccent` in as a dictionary.
  `to_tsvector('bible_simple', text)` is then IMMUTABLE — the property a `STORED GENERATED` column
  requires. (Calling `unaccent()` as a bare function is *not* immutable; wiring it into a config is the
  standard trick that is.)
- Greek → accent-insensitive + lexeme-aware + rankable. ✅ (the priority — SBL is the citation spine).
- English → lexeme-aware + accent-folded + rankable, but **NO stemming** (`loves` ≠ `love`).
- `simple` does no stop-word removal — correct for Greek (every word searchable; the planner's
  `LEMMA_STOP_WORDS` filtering lives at a different layer).

**Why A over the alternatives:**
- **A vs. B (per-corpus: Greek `simple`+unaccent, English `english`/Snowball stemming).** B gives real
  English stemming but a generated column cannot branch on corpus (the cuid/cross-table problem), so B
  forces a trigger-maintained `tsvector` or a denormalized language column + backfill — a stateful
  thing that must stay correct across every import/seed path (and those paths feed the count-pinned
  integration/acceptance suites). A is a single declarative, self-maintaining generated column.
  English is display-only / non-authoritative (WEB), so B's main advantage (English stemming) is the
  lowest-value capability here. A doesn't burn the bridge: English stemming can be added later as a
  focused follow-up, or absorbed by Phase 4's vector layer.
- **A vs. C (Greek-only FTS now).** C is narrowest but leaves the search UI showing ranked Greek next
  to dumb-substring English — inconsistent — and the English side would be redone later anyway.

**Deferred (not cancelled):** English Snowball stemming (`loves`=`love`, plurals, tense). Revisit if
real usage shows English keyword search needs it, or let Phase 4 handle English semantics.

> **Update 2026-06-13:** English Snowball stemming landed via migration `20260613120000_english_stem_fts` — `bible_english` immutable config (unaccent + english_stem) and a second stored `tsvector` column `Verse.textSearchEn` (+ `Verse_textSearchEn_idx` GIN index). English (WEB) keyword search and the assistant's semantic keyword leg now route through `bible_english`/`textSearchEn`; Greek (SBLGNT) keeps `bible_simple`/`textSearch` unchanged. Highlighting uses a per-row `ts_headline` matched to the config that ran the query.

## Architecture & components

### 1. Schema & migration (first hand-written migration in the project)

Prisma's `migrate dev` cannot autogenerate any of this, so it is a hand-authored SQL migration.
**Ordering matters**: extension + config must exist before the generated column references the config.

1. `CREATE EXTENSION IF NOT EXISTS unaccent;` (available on Neon).
2. Custom config `bible_simple`: clone `simple`, then remap the word-bearing token types through
   `unaccent` then `simple`:
   `ALTER TEXT SEARCH CONFIGURATION bible_simple ALTER MAPPING FOR asciiword, word, hword, hword_part, asciihword, numword, hword_numpart, numhword WITH unaccent, simple;`
   (Greek surface forms lex as `word`; the ascii/num variants keep English and alphanumerics covered.)
3. Generated column:
   ```sql
   ALTER TABLE "Verse" ADD COLUMN "textSearch" tsvector
     GENERATED ALWAYS AS (to_tsvector('bible_simple', "text")) STORED;
   ```
   (`STORED GENERATED` backfills existing rows on creation.)
4. GIN index: `CREATE INDEX "Verse_textSearch_idx" ON "Verse" USING GIN ("textSearch");`
5. `prisma/schema.prisma`: represent the column as `textSearch Unsupported("tsvector")?` so drift
   detection is satisfied and the column is documented. It is never read through the typed client.

### 2. Query layer — `searchKeyword` rewrite (`lib/search.ts`)

Prisma's query builder has no tsvector/`@@`/`ts_rank` support, so matching moves to **parameterized
`$queryRaw`**. The function keeps its **exact signature and return shape** — both consumers (the search
page `app/search/page.tsx` and the planner's `searchKeyword` call in `lib/ai/retrievalPlanner.ts`) are
untouched at the call site — with one **additive** optional param.

- **Match:** `websearch_to_tsquery('bible_simple', $query)` against `"textSearch" @@ query`.
  `websearch_to_tsquery` is forgiving of arbitrary user input (never throws on stray punctuation,
  supports quoted phrases and `-exclusion`) — important because the input is unsanitized user/assistant
  text.
- **Ordering (new optional param `orderBy`):**
  - default `"canonical"` → `ORDER BY book.order, chapter, verse` (preserves search-UI UX).
  - `"rank"` → `ORDER BY ts_rank("textSearch", query) DESC`, canonical as tie-break. The planner passes
    this so top-N truncation keeps the strongest evidence.
- **Count/pagination:** preserved. Count is a second `$queryRaw SELECT count(*)` sharing the same
  `WHERE`. Pagination math (`normalizePagination`, `paginationResult`) unchanged.
- **Filters:** corpus/book/chapter become explicit parameterized joins to `Corpus`/`Book` (replacing
  Prisma relation syntax). `normalizeBook` still applied; corpus default keeps the existing
  `abbreviation <> 'NET'` behavior.
- **Empty query:** same explicit early-return as today.
- **Safety:** all values flow through `$queryRaw` tagged-template placeholders; no string interpolation
  into SQL.

### 3. Consumer wiring

- `lib/ai/retrievalPlanner.ts`: the `searchKeyword(...)` call adds `orderBy: "rank"`. No other change;
  bounds (`MAX_WORD_SAMPLE`, `MAX_SECTION_LINES`, etc.) are unchanged but now truncate rank-ordered
  results.
- `app/search/page.tsx`: no change (defaults to canonical).

## Behavioral changes (intended)

1. **Substring → lexeme matching.** `log` no longer matches inside `logos` (whole-word precision).
   Confirmed desired. A few substring-style searches that "worked" return nothing now — correct, not a
   regression.
2. **Greek accent-insensitive.** `λογος` finds `λόγος` — net more recall on the spine.
3. **No English stemming** (Option A): `loves` ≠ `love`. English recall ≈ today minus substring
   fragments.
4. **Multi-word = AND-anywhere.** `websearch_to_tsquery` ANDs terms; `grace truth` matches verses
   containing both words anywhere (today's `ILIKE` required adjacency). Broader and more useful.
5. **Ranked evidence for the assistant.** When results exceed the sample caps, the planner keeps the
   highest-ranked verses instead of the canonically-earliest — strictly better grounding evidence.
6. **Search UI visually unchanged** — canonical order, same `SearchPanelResult` shape and pagination.

## Testing & verification

### Migration
Apply via `prisma migrate deploy` to the main dev Neon branch **and** the integration-acceptance Neon
branch. Verify extension, `bible_simple` config, generated column, and GIN index exist, and that
`textSearch` backfilled for the full NT corpus.

### Unit tests (`tests/unit/lib/search`)
FTS needs real Postgres, so unit coverage asserts query-construction invariants: `orderBy` switch
produces rank vs. canonical SQL, empty-query early return, pagination math, parameterization shape.

### Integration tests (`tests/integration/`) — the substantive coverage
- Greek accent-insensitivity: `λογος` finds `λόγος`.
- Whole-word not substring: `log` → nothing; `logos`/`λόγος` → the John 1 cluster.
- Multi-word AND: `grace truth` matches verses with both.
- Rank ordering: `orderBy: "rank"` puts denser matches first; canonical default preserved.
- Corpus/book/chapter scoping still filters correctly.
- Pagination/count correctness.

### Acceptance suite
Substring→lexeme changes which verses match for some queries, so re-derive the pinned keyword
assertions in `scripts/acceptance-test.js` against FTS results (NOT caught by `npm run verify` — see
the acceptance-corpus note), then confirm green.

### Assistant-impact testing (three tiers)
- **Tier 1 — evidence-diff harness (deliverable).** A reusable script running ~10–15 fixed
  representative prompts (word-study e.g. "logos in John", a passage, a deliberately-unsupported
  prompt, a multi-word concept e.g. "grace and truth", an accented-Greek query) through
  `retrievalPlanner` on both the `main`/ILIKE baseline and the FTS branch, **diffing assembled evidence
  + citations**. Deterministic, no API cost. Directly shows recall gains (e.g. John 1:14 via accent
  folding), any unintended losses, and rank-ordering effects before truncation. Seeds the Phase 6
  harness.
- **Tier 2 — grounding-outcome spot-check (manual verification).** Run the same prompts through the
  full assistant; record `grounded` + citation resolution; watch for answered↔withheld flips. One model
  call per prompt — a spot-check, not a gate.
- **Tier 3 — RAGAS-style answer-quality eval.** Explicitly deferred to Phase 6 (Evaluation harness).

### Gates & docs
- `npm run verify` (lint + tsc + build + coverage 80/80/75/65, branch floor 65%) stays green.
- Manual smoke per roadmap verification: run app, keyword search, assistant word-study, confirm
  citations resolve to real DB verses.
- Update `docs/PROJECT_STATE.md` (Milestone 3 → Phase 3 done), `ReadMe.md`, and
  `docs/security-register.md` (note the new `$queryRaw` surface + parameterization rationale) per
  CLAUDE.md.

## Out of scope / deferred
- English Snowball stemming (Option B) — ✅ landed 2026-06-13 (`bible_english`/`textSearchEn`; see update note above).
- pgvector / embeddings / RRF / cross-encoder rerank / sentence-window — Phase 4.
- RAGAS-style faithfulness eval harness — Phase 6.

## Key files
- `prisma/migrations/<new>/migration.sql` (hand-written), `prisma/schema.prisma` (`Unsupported`
  column).
- `lib/search.ts` (`searchKeyword` rewrite).
- `lib/ai/retrievalPlanner.ts` (`orderBy: "rank"`).
- `tests/unit/lib/search/*`, `tests/integration/*`, `scripts/acceptance-test.js`, new Tier-1
  evidence-diff script.
- Docs: `docs/PROJECT_STATE.md`, `ReadMe.md`, `docs/security-register.md`.
