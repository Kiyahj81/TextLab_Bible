# Milestone 3 Phase 4a — Vector + Hybrid Retrieval (design)

*Status:* Approved 2026-06-02 · *Scope:* NT-Greek subset · *Part of:* Milestone 3 (`docs/HiFi-exegesis-nt-roadmap.md`)

## Phase split (naming)

Phase 4 of the roadmap is split into two deliverables so progress is unambiguous:

- **Phase 4a (this spec):** pgvector + WEB per-verse embeddings + `searchSemantic` with RRF fusion of
  vector + FTS + V±2 sentence-window context assembly. A complete hybrid retrieval pipeline that stays
  within the project's existing OpenAI-only dependency set.
- **Phase 4b (deferred):** cross-encoder rerank (top-30 → top-5). Deferred because there is no local
  reranker and the project depends only on OpenAI, so a reranker means a new vendor (Cohere/Voyage)
  or an LLM-as-reranker. Tracked as the follow-up; not built here.

## Goal

Add the *vector half* of the architecture doc's hybrid retrieval pipeline to the existing NT corpus.
Today retrieval is deterministic + lexical only (passage / lemma / keyword-FTS / morphology in
`lib/search.ts` driven by `lib/ai/retrievalPlanner.ts`). Phase 4a adds semantic recall so conceptual /
topical questions ("what does Paul say about reconciliation") surface relevant verses even when the
exact query words never appear — then fuses those hits with the lexical results via Reciprocal Rank
Fusion and expands each hit to ±2 neighbor verses for synthesis context.

## Locked decisions

1. **Scope:** vector + RRF + V±2 windows now; cross-encoder rerank deferred to Phase 4b.
2. **Embed WEB English only.** Queries arrive in English and `text-embedding-3-small` is strongest on
   English. Citations still resolve to the SBLGNT spine via the shared `(book, chapter, verse)`.
3. **Per-verse embedding.** One vector per WEB verse — a hit *is* a verse, matching the verse-keyed
   citation model. (Distinct from V±2 *context assembly*, which is a retrieval-time expansion, below.)
4. **Vector search fires on topical/conceptual queries only.** Pure passage / lemma / morphology
   lookups skip the query-embedding call entirely; lexical retrieval already nails those.
5. **Architecture:** dedicated `VerseEmbedding` table (Option A), not a column on `Verse` and not a
   generalized `Chunk` table.
6. **Embedding model:** `text-embedding-3-small` (1536 dims) — fits pgvector's 2000-dim index limit
   directly (the 3072-dim `large` would need `halfvec`), cheap, fast query-time.
7. **One semantic index corpus.** WEB is the embedded semantic index. Additional English translations
   added later (e.g. LEB) are display-only, resolved by reference — never re-embedded (see Future-proofing).

## Architecture

### 1. Data layer

Migration `add_verse_embeddings` (raw SQL, mirroring the `lexical_fts` migration pattern):

- `CREATE EXTENSION IF NOT EXISTS vector;`
- New table `VerseEmbedding`:
  - `verseId String @id` — 1:1 with `Verse`, `onDelete: Cascade`.
  - `embedding vector(1536)` — declared in Prisma as `Unsupported("vector(1536)")`; never read through
    the typed client (KNN goes through `$queryRaw`, exactly like `Verse.textSearch`).
  - `model String` — the embedding model tag (e.g. `text-embedding-3-small`), so a future model change
    is detectable and re-embeddable.
  - `createdAt DateTime @default(now())`.
- HNSW index on `embedding` using `vector_cosine_ops`.

`schema.prisma`: a `VerseEmbedding` model with the `Unsupported` vector column + a relation field on
`Verse`. Only WEB verses get rows (no null vectors anywhere).

### 2. Ingestion script

`scripts/embed-verses.ts` + `npm run embed:verses`:

- Selects verses in the semantic-index corpus (`SEMANTIC_INDEX_CORPUS`) that have **no** current
  `VerseEmbedding` row → resumable / idempotent (re-runs only fill gaps).
- Batches verse text to OpenAI `text-embedding-3-small`; upserts `VerseEmbedding` rows tagged with `model`.
- Reads `DATABASE_URL` like the other import scripts → targets Neon automatically. ~8k NT verses,
  one-time, pennies.

### 3. Search layer — `searchSemantic` + RRF

New `SEMANTIC_INDEX_CORPUS = "WEB"` constant (single source of truth; the only place the embedded
corpus is named).

New in `lib/search.ts`:

- `embedQuery(text): Promise<number[] | null>` — one `text-embedding-3-small` call via the shared
  `getOpenAi()` client. Returns `null` when no API key is set (graceful degradation).
- `searchSemantic({ query, keywords?, book?, limit })` — embeds **`query`** (the full natural-language
  prompt) for the vector KNN (`$queryRaw`, `embedding <=> $1::vector` cosine distance, all values bound as
  parameters — no interpolation), **and** runs a parallel FTS pass over **`keywords`** (the distilled
  lexical topic words), then RRF-fuses the two rank lists. Returns a fused, ranked list of
  `{ corpus: SEMANTIC_INDEX_CORPUS, reference, text }`. Returns `[]` when `embedQuery` is null.
  - **Why two different inputs.** `bible_simple` is a clone of `simple` and therefore *retains
    stopwords*. An FTS `websearch_to_tsquery` over the full prompt would AND every word (including
    "what"/"does"/"about") and match nothing, so the FTS half uses the distilled `keywords`
    (`signals.topicWords`) instead. The vector half, by contrast, benefits from the full natural-language
    phrasing. When `keywords` is empty the FTS half is skipped and RRF degrades to vector-only.
  - **SBL-spine filter (required).** Before returning, drop any hit whose `(book, chapter, verse)` has
    no SBLGNT row. The semantic index is WEB, so KNN can surface a verse that exists in WEB but not in
    the SBLGNT spine (critical-text "missing verses" — e.g. Acts 8:37, Mark 15:28 — or other verse-set
    divergence). If such a verse reached synthesis and the model cited it, `verifyGrounding` would look
    up SBLGNT, find no row, return `reference-not-found`, and **withhold the entire answer**
    ([grounding.ts:99–102](../../../lib/ai/grounding.ts#L99-L102), [grounding.ts:132](../../../lib/ai/grounding.ts#L132)) —
    a good conceptual answer lost because one of several hits was off-spine. Filtering at retrieval keeps
    the citation-spine invariant intact (the model only ever sees verifiable verses), is self-contained
    in Phase 4a (no change to the Phase 2 grounding contract), and loses only the tiny set of WEB-only
    verses that would have caused a withholding anyway. Implementation: intersect the fused references
    against SBLGNT existence in one bounded query (the references are already in hand post-fusion).

New `lib/search/rrf.ts`:

- `reciprocalRankFusion(lists, k = 60)` — **pure** function. Score per item = Σ `1 / (k + rank)` across
  input lists; deduped by verse reference; returns items sorted by fused score descending. Unit-testable
  in isolation.

### 4. Planner integration — `semanticCall` + topical gate + V±2

In `lib/ai/retrievalPlanner.ts`:

- **Topical gate** `shouldRunSemantic(signals): boolean` — fires only when the prompt is conceptual:
  there are `topicWords` **and** the prompt is not fully pinned to exact verses (i.e. skip when there is
  at least one reference and *every* reference carries a `verseStart`). A bare-chapter reference,
  pure-lemma, or pure-morphology prompt still runs; a single- or multi-verse pinpointed lookup skips.
  Reuses the existing `Signals`; no new signal extraction.
- **`semanticCall(query, scope)`** — a new `PlannedCall`, added by `buildPlan` only when
  `shouldRunSemantic` passes. Counts against the existing `MAX_PLANNED_CALLS` budget. Calls
  `searchSemantic`, then **expands each top hit to V±2 neighbors** for synthesis context, and emits an
  evidence section (`### semanticSearch(…)`) + citations in the same shape as the other calls (reference,
  corpus, `searchQuery`, `toolName: "searchSemantic"`).
  - **Per-verse lines, discrete references.** Each verse in the window is rendered on its own line with
    its own reference (same format as `passageCall`: `- <reference>, <corpus>: <text>`), so the model
    cites individual verses cleanly — no multi-verse blob to disambiguate. The **citation anchor is the
    hit verse**; the ±2 neighbors are context the model may also cite.
  - **On-spine window (required).** Build the ±2 window from the **SBLGNT** verse range, then show WEB
    text for those references. A verse-range `getPassage` over SBL naturally omits any verse SBL lacks
    (the gap is simply not returned), so every context line is on-spine and citable by construction while
    still showing readable English. This prevents a **WEB-only neighbor** (e.g. hit Acts 8:36, window
    includes WEB-only Acts 8:37) from reaching the model and reintroducing the `reference-not-found`
    withholding the §3 hit filter closes.
- **Graceful degradation:** no `OPENAI_API_KEY` → `embedQuery` returns null → `searchSemantic` returns
  `[]` → `semanticCall` contributes nothing. The deterministic fallback is unaffected.

The V±2 expansion respects the existing `MAX_PASSAGE_LINES` / `MAX_EVIDENCE_CHARS` ceilings so a topical
query cannot blow the evidence budget.

**Query embedded = the full natural-language prompt; FTS half = distilled keywords.** `semanticCall`
passes the user's whole prompt (e.g. "What does Paul say about reconciliation") as `query` (embedded for
the vector half) and `signals.topicWords` joined as `keywords` (the FTS half). Embeddings handle natural
phrasing well and the surrounding context (e.g. "Paul") is meaningful semantic signal, whereas the FTS
half must use distilled keywords because `bible_simple` retains stopwords (see §3). This requires
threading the raw prompt into the planner: `runRetrievalPlan(signals, prompt)` and `buildPlan(signals,
prompt)` (prompt defaults to `""`, so existing callers/tests are unaffected and an empty prompt simply
yields no embedding). This is also a deliberate contrast with `lemmaCall`, which searches the mapped
*Greek* lemma — different inputs, complementary result sets.

**Semantic search is NOT suppressed when a topic word maps to a known lemma.** A prompt like "What does
Paul say about reconciliation" intentionally fires *both* `lemmaCall(καταλλαγή)` (precise Greek
concordance — verses where the word literally occurs) *and* `semanticCall` (conceptual recall — verses
*about* reconciliation where neither καταλλαγή nor the English word appears, e.g. Eph 2:16, Col 1:20–22).
These are complementary, not redundant, and surfacing both is the point of hybrid retrieval. Such a query
consumes two of the `MAX_PLANNED_CALLS` slots and the evidence packet carries both a `searchLemma(…)` and
a `semanticSearch(…)` section. (Synergy worth noting: Phase 3 deferred English stemming, so the FTS half
matches only the exact token "reconciliation" and misses "reconciled"/"reconcile"; the vector half covers
those morphological + semantic variants.)

### 5. Grounding & citations

No change to the Silence Protocol (`lib/ai/grounding.ts`). Semantic hits are WEB verses; their citations
carry the reference, so grounding still verifies cited claims against the **SBLGNT spine** (WEB remains
caveat-only). Vector search only changes *which* verses surface as evidence — never how claims are verified.
The SBL-spine filter in `searchSemantic` (§3) guarantees every semantic hit reaching synthesis resolves on
the spine, so semantic retrieval cannot trigger a spurious `reference-not-found` withholding.

## Future-proofing: adding another English translation (e.g. LEB)

The architecture supports it, and the recommended path keeps it cheap:

- `VerseEmbedding` is keyed by `verseId` (corpus-agnostic). A new translation is just new `Verse` rows
  under a new `Corpus`; the table shape, cascade, and ingestion script need no changes.
- **Do not embed every translation.** Keep **one** corpus as the semantic index (WEB, public domain).
  Additional translations are **display-only, resolved by reference** — the same layering as the
  SBLGNT-spine / WEB-display-aid model already in place. `searchSemantic` returns references; swapping in
  LEB text for display is then a pure read-side concern with zero embedding work.
- This deliberately avoids: duplicate same-verse hits across translations, double embedding
  cost/storage, and sending **copyrighted** LEB text to OpenAI's embeddings endpoint (WEB is public
  domain; LEB is not).
- The only seam baked in now is the `SEMANTIC_INDEX_CORPUS` constant — switching the index or embedding a
  different corpus later is a one-line change. A multi-translation *display* abstraction is intentionally
  **not** built now (YAGNI); it is its own future feature when a second English corpus actually lands.

## Testing

- **Unit:**
  - `tests/unit/lib/search/rrf.test.ts` — fusion math, dedupe by reference, k-weighting, empty lists.
  - `searchSemantic` query-building + null-key short-circuit (mocked OpenAI returns no client → `[]`) +
    SBL-spine filter drops a WEB-only reference before returning.
  - planner `shouldRunSemantic` gate — topical prompt fires; bare-reference / pure-lemma / pure-morph skip.
  - `semanticCall` — V±2 expansion shape (per-verse lines with discrete references, hit as citation
    anchor), on-spine window (a WEB-only neighbor in the ±2 range is omitted), citation shape, budget
    (counts against `MAX_PLANNED_CALLS`, respects `MAX_EVIDENCE_CHARS`).
- **Integration (Neon branch):** real `VerseEmbedding` KNN returns expected verses for a known topical
  query; RRF blends with FTS.
- **Acceptance:** `scripts/acceptance-test.js` assertions are pinned to exact corpus counts. Embeddings do
  not change verse/token counts, but the embedding ingestion must be run against the acceptance Neon branch
  (or the topical assertion guarded) so a topical-query interaction has data. Add/adjust one topical-query
  assertion and confirm the suite still exits 0.
- **Coverage gate** (80/80/75/65) stays green.

## Docs to update (per CLAUDE.md)

- `docs/HiFi-exegesis-nt-roadmap.md` — mark Phase 4a done; record Phase 4b (cross-encoder rerank) as the
  named deferred follow-up.
- `docs/Project_State.md` — new snapshot: hybrid retrieval, `VerseEmbedding`, `searchSemantic`, RRF, the
  topical gate, V±2 windows, the `embed:verses` script, new migration.
- `ReadMe.md` — note hybrid semantic retrieval + the `embed:verses` step.
- `docs/security-register.md` — note that topical query text is sent to OpenAI's embeddings endpoint (same
  trust boundary as existing synthesis calls).

## Out of scope (Phase 4b and beyond)

- Cross-encoder rerank (Phase 4b).
- Embedding Greek (SBLGNT) or multiple translations.
- Windowed (V±2 text) embeddings — per-verse only.
- A multi-translation display abstraction.
- OT / Strong's / speakers (deferred past Milestone 3).

## Verification

- `npm run verify` (lint + tsc + build + coverage) exits 0.
- `npm run test:integration` (Neon branch) exits 0.
- `npm run test:acceptance` exits 0.
- Manual: ask the assistant a conceptual question whose key verses don't contain the query words; confirm
  semantic hits appear in the tool trace, citations resolve to real SBLGNT verses, and grounding still
  refuses an unsupported claim.
