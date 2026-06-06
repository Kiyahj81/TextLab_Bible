# Milestone 3 — High-Fidelity NT Exegesis Roadmap

*Status:* Approved 2026-05-28; current through 2026-06-06 · *Scope:* NT-Greek subset · *Successor to:* Milestone 2.5 (shipped on `main`)

This is **Milestone 3**: bringing the mechanisms from
`docs/archived/Technical Architecture for High-Fidelity Biblical Exegesis.md` to the existing NT corpus,
delivered in **6 phases**. It also reconciles that aspirational architecture against what is built
today and records the scope and hosting decisions made during planning.

## Context

`docs/archived/Technical Architecture for High-Fidelity Biblical Exegesis.md` is a NotebookLM-sourced
*aspirational* blueprint (dated 2026-05-27). It describes a dual-layer system: a deterministic
PostgreSQL "source of truth" (word-level Greek/Hebrew/Aramaic alignment, Strong's, morphology,
Louw-Nida, speaker metadata, RAG chunks + pgvector) and a TypeScript orchestration layer doing
hybrid retrieval (FTS + vector + RRF + cross-encoder rerank), semantic model routing, and a
fact-grounding "Silence Protocol" with post-generation citation verification.

This document reconciles that target against what is actually built (Milestone 2.5, shipped on
`main`), answers **how far we are from the target architecture**, and defines Milestone 3 to close
the gap for the NT.

## Scope decision (LOCKED — 2026-05-28)

**Chosen scope: NT-Greek subset.** Pursue the doc's *mechanisms* (hybrid retrieval, grounding,
semantic routing) on the **existing NT Greek (SBLGNT/MorphGNT) + English (WEB) corpus only**, using
the MorphGNT and MACULA data already loaded. Goal: get the NT working as intended before any corpus
expansion.

**Explicitly OUT of scope for now** (deferred, not cancelled):
- OT Hebrew + Aramaic corpus (OSHB/WLC)
- Strong's numbers
- Speaker quotations (Clear-Bible gender/age/divinity/depth)
- Explicit token↔English word-alignment table

Louw-Nida domains are **IN scope** (decided 2026-05-28): the `domain` and `ln` columns already sit in
`data/macula-greek/macula-greek-SBLGNT.tsv`, so this is "data we already have." (The same TSV also
carries a `strong` column — Strong's remains deferred but is trivially available later.)

---

## Verdict: ~70% of the way there after Phase 5

The project now implements the doc's core runtime philosophy for the NT-Greek subset: relational DB
as source of truth, original-language tokens, retrieval-first assistant, user-confirmed scholarly
escalation, enforced grounding verification, lexical FTS, Phase 4a vector/hybrid retrieval, and
Phase 5 Louw-Nida semantic-domain enrichment (schema, reference table, popover display, `/search`
domain mode, and explicit-only assistant domain routing). The remaining high-fidelity gaps are
narrower: a fuller agentic tool loop, evaluation gates, and the larger data-expansion work (OT
Hebrew/Aramaic, Strong's, speakers, and explicit token-to-English alignment).

---

## Side-by-side reconciliation

> **Note:** this table has been refreshed after PR #9. Rows that were gaps in the Milestone 2.5
> baseline now show the current `main` state where the gap has been closed.

### A. Database / data layer

| Target (doc) | Current state | Gap |
|---|---|---|
| PostgreSQL + Prisma | ✅ PostgreSQL + Prisma 6 (`prisma/schema.prisma`) | None — matches |
| Verse table (BBCCCVVV) | ✅ `Verse` keyed by `(corpusId, bookId, chapter, verse)` | Different ID scheme (composite vs integer coordinate); functionally equivalent |
| Greek tokens w/ lemma, morph | ✅ `Token` (surface, normalized, lemma, morphCode, partOfSpeech, gloss) | None for Greek |
| Hebrew + Aramaic tokens | ❌ NT-only (SBLGNT + WEB) | **Major** — no OT at all |
| Strong's numbers (G/H) | ❌ no column | **Major** — core to doc's concordance queries |
| Louw-Nida domains | ✅ **Phase 5 done (5a + 5b)** — `Token.louwNida`/`lnDomain` arrays + GIN indexes (`lnDomain` in 5a, `louwNida` in 5b migration `20260607000000_louw_nida_search_index`); `LouwNidaDomain` reference table (738 nodes, migration `20260606070628_add_louw_nida`); `scripts/import-louw-nida.ts`; popover shows Domain/Subdomain labels; `/search` domain mode + explicit-only assistant domain routing (`searchDomain`, `getLouwNidaDomainOptions`, `domainQuery`/`domainCall`) | None for the NT subset |
| `word_alignments` table | ❌ implicit only (paired by book/ch/verse in `lib/search.ts`) | **Moderate** — no token↔English-word alignment table |
| `speaker_quotations` (gender/age/divinity/depth) | ❌ none | **Major** — Clear-Bible data not ingested |
| `chunks` + `pgvector` embeddings | ✅ pgvector `VerseEmbedding` table with one WEB per-verse `vector(1536)` embedding, model tag, `textHash`, and HNSW/cosine index | Phase 4a closed for verse-level embeddings; generalized chunks/window embeddings deferred |
| FTS `tsvector` + GIN | ⚠️ M2.5 used `ILIKE` substring → ✅ **closed in Phase 3** (`bible_simple` FTS + GIN) | Was Moderate; now closed |

### B. Retrieval pipeline

| Target (doc) | Current state | Gap |
|---|---|---|
| Hybrid lexical + vector search | ✅ `searchSemantic` fuses current-model WEB vector KNN with keyword FTS and deterministic lemma/keyword/morph/passage calls remain available through the retrieval planner | Phase 4a + 4b closed |
| Reciprocal Rank Fusion (k=60) | ✅ `lib/search/rrf.ts` pure RRF helper | Closed |
| Cross-encoder rerank (top-30→top-5) | ✅ Voyage rerank-2.5 via AI Gateway (graceful fallback to RRF) | Closed |
| Query expansion (synonyms/lemmas) | ⚠️ hardcoded English→Greek lemma/entity/phrase map plus semantic recall; Phase 5b adds explicit-only Louw-Nida domain-aware retrieval (`domain 33` / `LN 33.55`, anchored — never trips on `John 3.16`); no broad synonym expansion yet | **Minor/Moderate** |
| Sentence-window context (V±2) | ✅ semantic hits expand to an on-spine ±2 verse window; WEB display text is used only for references present in SBLGNT | Closed for semantic retrieval |
| Two design specs drafted | ✅ `docs/superpowers/specs/2026-05-27-{hybrid,agentic}-*.md` | These plan the *next* step but stop short of vectors/RRF/rerank |

### C. Model orchestration & routing

| Target (doc) | Current state | Gap |
|---|---|---|
| TypeScript orchestration layer | ✅ `lib/ai/assistant.ts` + `lib/ai/modelRouter.ts` | Matches in spirit |
| OpenAI provider | ✅ `openai@4` SDK, Responses API (`lib/ai/openaiClient.ts`) | Doc shows Vercel AI SDK 6 `ToolLoopAgent`; current is raw OpenAI SDK |
| Semantic intent routing → model tier | ✅ `routeAssistantPrompt` detects scholarly cues and user-confirmed escalation re-runs on `gpt-5.4`; automatic embedding/classifier routing is still deferred | Minor — heuristic routing, but escalation is wired |
| Tool-calling agent loop | ⚠️ synthesis can call `getPassage` for missing adjacent context, but there is no general multi-tool agent loop | **Moderate** (agentic spec drafted, not fully built) |
| Stateless <20ms routing | ⚠️ routing is cheap/stateless but keyword-based, not embedding-based | Minor |

### D. Fact-grounding / Silence Protocol

| Target (doc) | Current state | Gap |
|---|---|---|
| Structured citations linked to `verse_id`/`token_id` | ✅ citations/tool trace are persisted; token IDs are carried where available | Mostly closed |
| Post-retrieval fuzzy-match verification | ✅ `verifyGrounding` resolves cited references and fuzzy-matches Greek quotes against SBLGNT | Closed |
| Silence Protocol (refuse < threshold) | ✅ answers are withheld when SBLGNT quote verification fails or a cited reference is not found | Closed |
| RAGAS faithfulness eval (>0.90) | ❌ none | **Moderate** |

### E. Already-strong areas the doc doesn't emphasize (current project is *ahead* here)

- Auth.js v5 + OAuth, session revocation, CSP/HSTS/same-origin hardening, 10 req/min rate limiting.
- ~200 unit tests + coverage gate, DB integration tests, Playwright acceptance suite.
- Reader with per-word English highlighting + morphology popovers; notes; saved searches.

---

## How far away, by capability (rough effort to reach target)

| Capability | Distance | Est. effort |
|---|---|---|
| Agentic tool-calling (spec already written) | Medium | ~2–4 days for a fuller loop |
| Real semantic routing + scholarly escalation | Mostly closed | follow-up only if replacing heuristic cues with classifier/embedding routing |
| FTS (`tsvector`/GIN) + keyword ranking | Closed | done in Phase 3 |
| Grounding verification + Silence Protocol | Closed | done in Phase 2 |
| pgvector + embeddings + hybrid + RRF + rerank | Closed | Phase 4a + 4b done |
| Louw-Nida (data + schema + popover + domain search) | **Closed (5a + 5b)** | done — `/search` domain mode + explicit-only assistant domain routing landed in 5b |
| Strong's numbers (need source + schema) | Medium | ~3–5 days |
| Speaker quotations (Clear-Bible ingest) | Medium | ~3–5 days |
| Hebrew + Aramaic OT corpus (OSHB/WLC + alignment) | Far | ~2–4 weeks |
| RAGAS-style eval harness | Medium | ~2–3 days |

**Net:** the orchestration/grounding/lexical/vector retrieval core is now in place for the NT. The
remaining Milestone 3 work is mainly enrichment and evaluation; the larger data-completeness half
(OT, Strong's, speakers, full alignment) remains a deferred multi-week data-engineering effort.

---

## Milestone 3 — the 6 phases (sequenced cheapest-highest-value first)

Scope is locked (above). Phases are ordered so each ships a working improvement on its own. Phases
1–2 are cheap, high-value, and have drafted specs; Phase 4 is the heavy lift.

**Phase 1 — Orchestration upgrade. ✅ DONE (branch `milestone-3/phase-1-orchestration`).** Implemented
the deterministic-first pipeline (`lib/ai/signals.ts`, `retrievalPlanner.ts`, `synthesis.ts`;
`assistant.ts` reduced to orchestration) plus user-confirmed scholarly escalation
(`routeAssistantPrompt(prompt, escalate)`, `escalate` flag on the API, "Use scholarly model" UI).
`npm run verify` green (lint + tsc + build + coverage); DB integration + acceptance pending a Neon
test branch. Original plan below.

**Phase 1 — Orchestration upgrade. Implement Paradigm C, as drafted.** Replace the five-branch
dispatch table with the deterministic-first pipeline from
`docs/superpowers/specs/2026-05-27-hybrid-assistant-retrieval-design.md`, and additionally wire
*real* scholarly escalation (PROJECT_STATE "Step 3") so a confirmed scholarly query actually calls
`gpt-5.4` instead of only advising it.
- New files (per the C spec): `lib/ai/{signals,retrievalPlanner,synthesis}.ts` + their unit tests.
- Modify: `lib/ai/assistant.ts` (delete branches, keep `detectBookFromPrompt`), `lib/ai/modelRouter.ts`.
- Resolve the C spec's four open questions (§10) during implementation: multi-`getPassage` handling
  (recommend "execute all in first round"), proper-noun filtering, whether `ENGLISH_TO_GREEK_LEMMA`
  moves to JSON, and separating UI-facing guardrails copy from the live synthesis prompt
  (`lib/ai/assistantGuardrailsDisplay.ts` vs. `SYNTHESIS_SYSTEM_PROMPT` in `lib/ai/synthesis.ts`).

> **How the two specs factor in (important — two different meanings of "hybrid"):**
> - Paradigms **B** and **C** are competing designs for the *orchestration style* over the
>   **existing** keyword/lemma/morph search in `lib/search.ts`. Both explicitly list semantic/vector
>   search as a **non-goal**. "Hybrid" in the C spec's title means "deterministic preprocessor +
>   model refinement," NOT lexical+vector fusion.
> - We are **implementing C**, not replacing it with something different. The only deviation: C lists
>   scholarly escalation as a non-goal, and we add it — so Phase 1 = "C as written" + the escalation
>   C deferred.
> - **Paradigm B is deferred, not discarded.** The C spec itself (§12) recommends shipping C first,
>   then revisiting B once real usage shows where the deterministic detectors miss; C's planner is
>   designed to become B's pre-retrieval layer with minimal rework.
> - The **architecture doc's "Hybrid Retrieval Pipeline"** (lexical FTS + pgvector + RRF +
>   cross-encoder rerank) is a *different, deeper layer* that both specs deliberately excluded. It is
>   **Phases 3–4 of this roadmap**, and it plugs in *underneath* C's planner: `retrievalPlanner.ts`
>   gains a hybrid-search call alongside (or replacing) the current keyword/lemma searches. So the
>   specs and the doc are complementary layers, not alternatives.

**Phase 2 — Grounding + Silence Protocol. ✅ DONE (branch `milestone-3/phase-2-grounding`).** SBLGNT
is the authoritative citation spine: a Greek-quote mismatch (fuzzy score < 0.90) or an unresolvable
reference fails the claim and the answer is withheld. WEB is a non-authoritative display aid — a WEB
mismatch or missing verse sets an alignment caveat but does NOT refuse ("caveat-only" — the caveat is
appended; the English aid is not yet stripped from the prose, tracked as a follow-up). Synthesis
now returns structured JSON (`answer` + `claims[]`) via a strict json\_schema output format. The
verifier runs between synthesis and persistence: the withheld refusal is what gets stored, never the
draft. A `grounded` boolean (+ optional `groundingReport`) is recorded in `AssistantMessageMetadata`
and surfaced as a "Withheld — insufficient evidence" banner in `AiAssistant`. New files:
`lib/ai/grounding.ts`, `lib/text/similarity.ts`, `lib/references.ts` (`parseReference`). Original
plan below.

**Phase 2 — Grounding + Silence Protocol (original plan).** Post-synthesis verifier: extract cited references, fetch
the real DB verse text, fuzzy-match (Levenshtein/substring ≥0.90), and refuse with a structured
"insufficient textual evidence" message on failure. New: `lib/ai/grounding.ts`, invoked at the API
boundary in `app/api/assistant/route.ts`. This is the single biggest fidelity win and uses only the
NT data we already have.

**Phase 3 — Lexical FTS. ✅ DONE (branch `milestone-3/phase-3-lexical-fts`).** Custom immutable
text-search config `bible_simple` (clone of `simple` with `unaccent` wired in as a dictionary, making
`to_tsvector` IMMUTABLE — required by the generated column). `Verse.textSearch` stored GENERATED
`tsvector` column + `Verse_textSearch_idx` GIN index (migration
`prisma/migrations/20260530120000_lexical_fts/`). `searchKeyword` in `lib/search.ts` rewritten from
ILIKE substring to `$queryRaw` / `websearch_to_tsquery('bible_simple', …)` — the project's first raw
SQL in the search layer; all user-supplied values bound via `Prisma.sql` tagged templates (no string
interpolation). New `orderBy?: "canonical" | "rank"` param (default canonical; rank uses `ts_rank`
DESC with canonical tiebreak); retrieval planner passes `orderBy: "rank"` so evidence truncation
keeps the strongest verses. Behaviour: accent-insensitive Greek (λογος finds λόγος), whole-lexeme
matching not substring ("log" no longer matches inside "logos"), multi-word AND queries ("grace
truth" finds John 1:14). English Snowball stemming intentionally DEFERRED — a single unified
accent-folded `simple` config covers both languages. New: 4 unit tests
(`tests/unit/lib/search-keyword.test.ts`), 6 integration tests (`tests/integration/fts-search.test.ts`),
evidence-diff harness (`scripts/evidence-diff.ts`). Original plan below.

**Phase 3 — Lexical FTS (original plan).** Add a `tsvector` column + GIN index migration on `Verse.text`; replace the
`ILIKE` substring match in `searchKeyword` (`lib/search.ts`) with ranked full-text search. Lexical
half of hybrid retrieval; also improves the standalone search UI.

**Phase 4a — Vector + hybrid retrieval. ✅ DONE (merged via PR #9).** pgvector
`VerseEmbedding` table (WEB per-verse, `text-embedding-3-small`, HNSW/cosine) plus `textHash` stale-text
detection; `searchSemantic` filters to the current embedding model, fuses vector KNN + keyword FTS via
Reciprocal Rank Fusion (`lib/search/rrf.ts`), and filters hits to the SBLGNT spine; a gated
`semanticCall` in the planner fires only on conceptual prompts with real topic/phrase evidence and
expands each hit to an on-spine ±2 window; `npm run embed:verses` ingestion script re-embeds only when
the row is missing, the model differs, or WEB text changed. Citations resolve to the SBLGNT spine;
WEB-only verses are filtered out of both hits and ±2 neighbors so semantic retrieval cannot trigger a
spurious withholding. New: `lib/search/rrf.ts`, `scripts/embed-verses.ts`, migrations
`20260602120000_add_verse_embeddings` and `20260603120000_add_verse_embedding_text_hash`.

**Phase 4b — Cross-encoder rerank. ✅ DONE (branch `milestone-3/phase-4b-rerank`).** A
retrieve-then-rerank stage on the assistant's semantic pool: `lib/search/rerank.ts` reranks the
RRF-fused, SBL-spine-filtered candidates (top-30 → top-5) on WEB English text via **Voyage
rerank-2.5** through **Vercel AI Gateway** (AI SDK `rerank`). Gated on `AI_GATEWAY_API_KEY`;
missing key / error / timeout falls back to RRF order (graceful no-op). RRF remains the
candidate-assembly + fallback ranker. New: `lib/search/rerank.ts`, `scripts/rerank-diff.ts`,
dep `ai` (plain model-id string routes through the SDK's built-in gateway provider).

**Phase 4 — Vector + hybrid retrieval (original plan).** Enable `pgvector`; add a `chunks` table (or
embedding column) at verse / verse-window granularity; build an embedding ingestion script (likely
OpenAI embeddings given existing integration, or a multilingual model for Greek); implement RRF
fusion of FTS + vector results (k=60), then cross-encoder rerank (top-30→top-5) and sentence-window
(V±2) context assembly. Completes the doc's hybrid pipeline for the NT.

**Phase 5 — Louw-Nida enrichment. ✅ DONE (5a + 5b; branches `milestone-3/phase-5-louw-nida`, then `milestone-3/phase-5b-domain-search`).** Phase 5a delivered: `Token.louwNida String[] @default([])` (ln refs, e.g. `33.38`) + `Token.lnDomain String[] @default([])` (MARBLE numeric codes, e.g. `033005`) + GIN index on `lnDomain`; `LouwNidaDomain` reference table (`code` PK, `level`, `label`, `parentCode`); migration `20260606070628_add_louw_nida`; `scripts/import-louw-nida.ts` (`npm run import:louw-nida`) — idempotent upsert of 738 domain/subdomain rows vendored from the UBS lexical-domains JSON (CC-BY-SA 4.0, `data/louw-nida/NOTICE.md`); `parseMaculaTsv` now parses `domain`/`ln` TSV columns into arrays; `importMaculaGreekGlosses` persists codes through all three token write paths; `lib/louwNida.ts` (`flattenLouwNidaDomains`, `resolveTokenDomains`); `getReaderPassage` batch-resolves codes to labels; `MorphologyPopover` renders Domain/Subdomain rows. Phase 5b adds domain-aware retrieval: a GIN index on `Token.louwNida` (migration `20260607000000_louw_nida_search_index`); `searchDomain` + `getLouwNidaDomainOptions` in `lib/search.ts`; the `/search` **domain** mode (domain dropdown `33 — Communication`, dependent subdomain dropdown, free-text LN-reference field `33.55`); an explicit-only, anchored assistant `domainQuery` signal (`domain 33` / `LN 33.55`, never trips on `John 3.16`) feeding a planner `domainCall`; new unit + integration tests (`tests/unit/lib/search-domain.test.ts`, signals/planner additions, `tests/integration/louw-nida-search.test.ts`). Saving domain searches and MARBLE-range subdomains are out of scope for v1. Original concrete steps below (for reference):

1. ✅ `prisma/schema.prisma`: added `louwNida String[]` + `lnDomain String[]` arrays + GIN index (5a); Phase 5b adds the `Token.louwNida` GIN index.
2. ✅ New migrations `20260606070628_add_louw_nida` (5a) and `20260607000000_louw_nida_search_index` (5b).
3. ✅ `scripts/import-open-bible.ts`: `parseMaculaTsv` now parses `ln`/`domain` columns; `importMaculaGreekGlosses` carries codes through all write paths.
4. ✅ Re-run `npm run import:louw-nida` (seed reference table), then `npm run import:macula-glosses` (backfill token codes).
5. ✅ Morphology popover surfaces Domain/Subdomain labels (5a); assistant domain routing + `/search` domain mode (5b).

**Phase 6 — Evaluation harness.** RAGAS-style faithfulness (target >0.90) + context-precision checks
to guard quality and catch grounding regressions as phases land.

**Deferred past Milestone 3:** OT Hebrew/Aramaic, Strong's numbers, speaker quotations, explicit
word-alignment table.

---

## Database hosting: Neon status and Docker migration notes

**Status 2026-06-03:** implemented for the maintainer/dev and test workflows. The checked-in Prisma
schema has both `DATABASE_URL` and `DIRECT_URL`, `.env.test` targets a separate Neon branch, and
`db:push` is disabled so handwritten SQL migrations are applied through `npm run db:migrate:deploy`.
The notes below remain as the historical migration rationale and setup reference.

Original goal: stop depending on a local Docker Postgres (`localhost:5433`) for dev/testing by hosting
the DB on Neon (serverless Postgres). Current setup: `prisma/schema.prisma` datasource uses only
`url = env("DATABASE_URL")`; `lib/db.ts` uses a plain `PrismaClient` (no driver adapter); Prisma 6.7.

**This is mostly a connection-string + config change — minimal code.** Neon speaks standard Postgres
over TLS, and Prisma 6 connects with no driver-adapter required for a Next.js Node server.

**Required changes**
1. **Neon project** → create one, then copy two connection strings from the dashboard:
   - **Pooled** (host contains `-pooler`, uses PgBouncer) — for the app at runtime.
   - **Direct** (no `-pooler`) — for migrations.
   Both need `?sslmode=require`.
2. **`prisma/schema.prisma`** — add a direct URL so migrations bypass the pooler:
   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")     // pooled (runtime)
     directUrl = env("DIRECT_URL")       // direct (migrations)
   }
   ```
3. **`.env` / `.env.example`** — set `DATABASE_URL` to the pooled string and add `DIRECT_URL` for the
   direct string. Keep the old Docker URL commented for offline fallback.
4. **Run migrations against Neon:** `prisma migrate deploy` (apply existing migrations) — `prisma
   migrate dev` also works via `directUrl` (needs a role with createdb for the shadow DB).
5. **Seed / import:** `npm run db:seed` and `npm run import:open-bible` / `import:macula-glosses`
   already read `DATABASE_URL`, so they'll target Neon automatically. Full-NT import over the network
   is slower than localhost but fine.

**No change needed** to `lib/db.ts` for a Node-runtime Next.js server.

**Notable considerations / caveats**
- **pgvector works on Neon** (`CREATE EXTENSION vector`), so Phase 4 stays compatible — good.
- **Integration tests** (`test:integration`, `test:acceptance`) run real, destructive Prisma writes
  against `DATABASE_URL`. **Decision (2026-05-28): use a Neon branch** as an ephemeral, isolated test
  DB — no Docker at all. Tests will point at a dedicated Neon branch's connection string (e.g. via a
  separate `.env.test` / CI secret), keeping the main branch's data clean.
- **Driver adapter (`@prisma/adapter-neon` + `@neondatabase/serverless`)** is **only** needed for
  edge/serverless-function runtimes wanting WebSocket pooling. Not required now; revisit only if the
  app is later deployed to an edge runtime.
- **Connection limits:** always use the pooled URL at runtime so Next.js serverless invocations don't
  exhaust Neon connections.
- `AUTH_*`, `OPENAI_*` env vars are unaffected.

---

## Verification (for any phase actually executed)

- `npm test` (unit) + coverage gate must stay green (80/80/75/65; branch floor 65%).
- DB integration tests (`tests/integration/`) and Playwright acceptance suite pass.
- Manual: run app, ask the assistant a word-study, a passage, and a deliberately unsupported
  question — confirm citations resolve to real DB verses and (Phase 2+) unsupported claims trigger
  refusal rather than fabrication.
- Update `docs/PROJECT_STATE.md`, `README.md`, and `docs/security-register.md` per CLAUDE.md after
  any major change.

---

## Key files referenced

- Data: `prisma/schema.prisma`, `prisma/seed.ts`, `scripts/import-open-bible.ts`,
  `data/macula-greek/macula-greek-SBLGNT.tsv`, `data/web-usfm/`
- Retrieval: `lib/search.ts`, `lib/search-highlight.ts`
- Assistant: `lib/ai/assistant.ts`, `lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`,
  `lib/ai/synthesis.ts`, `lib/ai/modelRouter.ts`, `lib/ai/openaiClient.ts`,
  `lib/ai/assistantGuardrailsDisplay.ts`, `app/api/assistant/route.ts`
- Specs (orchestration designs): `docs/superpowers/specs/2026-05-27-hybrid-assistant-retrieval-design.md`,
  `docs/superpowers/specs/2026-05-27-agentic-assistant-tool-calling-design.md`
- Source architecture: `docs/archived/Technical Architecture for High-Fidelity Biblical Exegesis.md`
- Status: `docs/PROJECT_STATE.md`
