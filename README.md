# TextLab Bible

TextLab Bible is a full-stack New Testament Greek exegesis app with a corpus-backed reader, search, notes, and a retrieval-first AI Study Assistant. The current corpus scope is the NT-Greek subset: SBLGNT Greek, WEB English, MorphGNT morphology, MACULA gloss enrichment, and UBS Louw-Nida semantic domains.

Milestone 3 is complete for this scope. The app now includes lexical full-text search, vector/hybrid retrieval, optional cross-encoder reranking through Vercel AI Gateway, Louw-Nida domain search, grounded assistant synthesis, and a two-tier evaluation harness. The search surface offers segmented keyword, lemma, morphology, and domain modes with inline guidance, example searches, results that link straight into the reader, and human-readable morphology tooltips.

Deferred beyond the current scope: OT Hebrew/Aramaic, LXX, Strong's numbers, speaker quotation metadata, explicit Greek-English word alignment, broader synonym expansion, and a more general multi-tool agent loop.

## Product Surface

- **Reader** at `/read`
  - Greek / English / Parallel display modes, persisted per reader via cookie and rendered server-side (no first-paint flash). A chapter masthead and a sticky bar keep your location visible while scrolling.
  - A Study / Continuous layout toggle (also cookie-backed): Study is the per-verse layout, Continuous flows the passage as prose with superscript verse numbers. Continuous is single-language only — in Parallel it's disabled and falls back to Study. Words stay tappable (morphology + highlighting) in both layouts.
  - Verses use inline verse numbers; the corpus label (SBLGNT / WEB) appears once per chapter as a column header. Single-language modes cap the reading measure for legibility.
  - Greek token popovers with lemma, morphology, gloss, and Louw-Nida domain/subdomain labels when present.
  - English word and Greek token highlighting apply optimistically (no full-page reload). Per-verse notes open on demand.
  - Verse and chapter navigation — dropdowns plus a free-text reference quick-jump (type "John 3:16" or "John 3.16") in the always-visible sticky bar — and last-passage restore (applied server-side on a bare `/read` visit).
  - Notes surface while you read: a passage **notes drawer** in the sticky bar (grouped by reference, jump to a verse, shown only when the chapter has notes) plus note lists inside the word and verse areas — all with inline edit and delete.
- **Search** at `/search`
  - A segmented mode control (Keyword / Lemma / Morphology / Domain) with per-mode placeholders, hint text, and clickable example searches on the empty state; the no-results state gives per-mode recovery guidance.
  - Keyword search with PostgreSQL full-text search. English (WEB) rows use the `bible_english` config (Snowball stemming — `love` matches `loves`, `loved`, and `loving`; every typed word matches, including common words like `just`, `no`, and `own`); Greek (SBLGNT) rows use `bible_simple` (accent-insensitive, whole-lexeme, not stemmed). Highlights track the stemmer via a per-row `ts_headline`.
  - Lemma search over token lemmas.
  - Morphology search over token morphology codes, with Robinson-ordered queries (for example `V-PAI-3S`) normalized to the stored scheme and human-readable tooltips on result codes (`V-3PAI-S` reads as "verb — present active indicative, 3rd person singular").
  - Louw-Nida domain search with domain/subdomain dropdowns and exact LN-reference lookup.
  - Result references link into the reader at the matching passage; keyword hits that fall outside the SBLGNT citation spine render as plain text. A results label names the mode and scope (for example `116 results for lemma "λόγος" in John`).
  - Friendly pagination with absolute ranges (`Showing 26–50 of 116`) and a page-size selector; the chapter filter is numeric and stays disabled until a book is chosen.
  - Saved searches scoped to the signed-in user, showing friendly book names and persisting the executed mode; status, rename, and delete feedback announce through accessible live regions.
- **AI Study Assistant** at `/assistant`
  - Routes each prompt before retrieval: a live LLM complexity classifier (falling back to a deterministic weighted score) decides whether the question needs the scholarly model; scholarly routing also widens retrieval to a deeper pass.
  - Runs local retrieval before synthesis.
  - Shows structured citations and retrieval trace entries.
  - Supports live OpenAI synthesis when configured, deterministic local fallback when not configured. Complex questions auto-escalate to the scholarly model by default; an "ask before using the scholarly model" toggle asks for confirmation first instead, and users can also request scholarly mode manually at any time.
  - Applies the Grounding / Silence Protocol before returning or storing an answer.
  - Labelled controls throughout; save/error status and copy confirmations announce through accessible live regions.
- **Notes** at `/notes`
  - User-scoped notes, generated study notes, tags, reference filters, search, sorting, pagination, and Markdown export.
  - Editable note fields are labelled, and save/result-count feedback announces through accessible live regions.
- **Authentication**
  - Protected app pages redirect to `/signin`.
  - Auth.js v5 uses JWT sessions with a DB-backed revocation watermark.
  - Local development can use the dev credentials provider; production should use GitHub OAuth or another real provider.

The root route redirects to `/read`.

## Architecture

| Layer | Primary files | Notes |
| --- | --- | --- |
| App routes | `app/read`, `app/search`, `app/assistant`, `app/notes`, `app/signin`, `app/api/*` | Next.js App Router surfaces and server endpoints. |
| Reader/search data | `lib/search.ts` (facade over `lib/search/{shared,reader,keyword,tokens,domain}.ts`), `lib/louwNida.ts`, `lib/references.ts`, `lib/searchLabel.ts`, `lib/morphology.ts` | Canonical passage, token, keyword, lemma/morphology, domain, and reference helpers (the search logic lives in the `lib/search/*` modules), plus the `readerHref` link builder, result-label formatting, and the morphology-code decoder/normalizer. |
| Assistant orchestration | `lib/ai/assistant.ts`, `lib/ai/modelRouter.ts`, `lib/ai/complexity.ts`, `lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`, `lib/ai/synthesis.ts`, `lib/ai/grounding.ts` | Route-then-retrieve assistant pipeline: LLM/weighted-score complexity routing, deterministic-first retrieval, synthesis, and grounding checks. |
| Semantic retrieval | `lib/search/semantic.ts`, `lib/search/semanticIndex.ts`, `lib/search/rrf.ts`, `lib/search/rerank.ts`, `scripts/embed-verses.ts` | pgvector embeddings, hybrid RRF retrieval, and optional Voyage rerank through Vercel AI Gateway. |
| Persistence | `prisma/schema.prisma`, `prisma/migrations/*` | PostgreSQL schema, handwritten FTS/vector migrations, Auth.js adapter tables, notes, saved searches, assistant history, import runs. |
| Evaluation | `eval/*`, `scripts/eval-gate.ts`, `scripts/eval-report.ts`, `.github/workflows/*` | Deterministic gate and weekly hybrid faithfulness report. |

Core stack:

- Next.js 15.3 / React 19 / TypeScript 5.8
- Prisma 6.7 / PostgreSQL
- Auth.js v5 beta
- OpenAI Node SDK v4 and AI SDK v6
- Vitest, Playwright, ESLint, TypeScript, v8 coverage

## Assistant Retrieval Pipeline

The assistant is deliberately retrieval-first, and routing now runs *before* retrieval so a scholarly decision can widen it. A normal request flows through:

1. Route the prompt: in live mode, an LLM complexity classifier (`OPENAI_ROUTER_MODEL`, default `gpt-5.4-mini`; 3s timeout, no retry) judges whether the question needs scholarly synthesis, falling back to a deterministic weighted-score classifier on any classifier failure or when live synthesis is off. Complex questions auto-escalate to the scholarly model by default; a user preference ("ask before using the scholarly model when a question looks complex") asks for confirmation instead of escalating automatically, and the user can also request scholarly mode manually at any time.
2. Extract references, book/chapter scope, Greek words, topics, morphology, domain signals, and phrase terms.
3. Plan deterministic searches: passage lookup, lemma, morphology, keyword, domain, and scoped chapter searches. Scholarly-routed requests run in **deep mode** — up to 12 deterministic calls instead of the standard 8, plus an additional corpus-wide semantic pass.
4. Add semantic retrieval for topical prompts when `OPENAI_API_KEY` and embeddings are available.
5. Optionally rerank semantic candidates through Vercel AI Gateway when `AI_GATEWAY_API_KEY` is set.
6. Synthesize from the retrieved evidence.
7. Verify citations and Greek quotes against the SBLGNT citation spine.
8. Store the response only after grounding succeeds; otherwise store and display the withheld answer state.

Routing only runs in live mode (an OpenAI key configured and `TEXTLAB_ASSISTANT_DISABLE_LIVE` unset); a non-live request never routes and always answers with the deterministic fallback at standard retrieval depth.

WEB citations are display aids. SBLGNT is the citation authority used for grounding.

## Corpus And Data Sources

| Source | Role | Notes |
| --- | --- | --- |
| SBLGNT / MorphGNT | Greek NT text, tokens, lemmas, morphology | SBLGNT is the grounding and citation spine. |
| WEB USFM | English NT display/search aid | Public-domain English text. |
| MACULA Greek | Glosses and lexical enrichment | Adds glosses, Louw-Nida code arrays, and Pericope Adulterae token coverage. |
| UBS Louw-Nida lexical domains | Semantic domain labels | Vendored JSON in `data/louw-nida/`, imported into `LouwNidaDomain`. |

Louw-Nida data attribution: *A Greek-English Lexicon of the New Testament Based on Semantic Domains* domain labels are from UBS (`ubsicap/ubs-open-license`), licensed CC-BY-SA 4.0. Keep attribution and ShareAlike obligations with any redistribution of the data or adapted domain-label dataset. See `data/louw-nida/NOTICE.md`.

## Local Setup

Prerequisites:

- Node.js `>=22.15`
- PostgreSQL, typically a Neon branch for development
- A shell that can run npm scripts

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`, then set at least:

```bash
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
AUTH_SECRET="..."
AUTH_URL="http://localhost:3000"
AUTH_DEV_ENABLED="1"
```

Apply migrations:

```bash
npm run db:migrate:deploy
```

Use migrations, not `db:push`. `db:push` is intentionally disabled because the FTS and vector features depend on handwritten migrations for `unaccent`, `bible_simple`, generated `tsvector`, GIN indexes, `pgvector`, `VerseEmbedding`, and embedding hash columns.

For a minimal local sample dataset:

```bash
npm run db:seed
```

For the full open-text NT corpus, run the import flow instead of relying on the sample seed:

```bash
npm run import:louw-nida

npm run import:open-bible -- \
  --morphgnt-url-base https://raw.githubusercontent.com/morphgnt/sblgnt/master \
  --web-usfm-dir ./data/web-usfm \
  --macula-greek-tsv ./data/macula-greek/macula-greek-SBLGNT.tsv
```

After the corpus is imported, generate semantic-search embeddings if live semantic retrieval is needed:

```bash
npm run embed:verses
```

`embed:verses` requires `OPENAI_API_KEY`. It is idempotent and re-embeds only when an embedding is missing, the model changes, or the stored WEB text hash is stale.

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`. Unauthenticated visits to protected pages redirect to `/signin`.

### Windows TLS Note

Most npm scripts set `NODE_OPTIONS=--use-system-ca` so Node trusts the Windows certificate store when a local proxy or antivirus product intercepts TLS. The first `npm install` happens before package scripts can apply that flag. If dependency installation fails with `unable to verify the first certificate` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run the install with `NODE_OPTIONS=--use-system-ca` set in the shell, or set it once at user scope and reopen the terminal.

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Runtime PostgreSQL connection. Neon pooled URL is recommended for deployed runtime. |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection for Prisma migrations. |
| `AUTH_SECRET` | Yes | Auth.js secret. Generate a long random value. |
| `AUTH_URL` | Yes | Public app URL, for example `http://localhost:3000` locally. |
| `AUTH_DEV_ENABLED` | Local only | Set to `1` for local dev sign-in. Never enable in production. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Production auth | Enables GitHub OAuth when both are set. |
| `OPENAI_API_KEY` | Optional | Enables live synthesis, query embeddings, and `embed:verses`. Without it, assistant synthesis falls back locally. |
| `OPENAI_DEFAULT_MODEL` | Optional | Default live synthesis model. |
| `OPENAI_SCHOLARLY_MODEL` | Optional | Model used for scholarly escalation (auto-routed or user-confirmed). |
| `OPENAI_ROUTER_MODEL` | Optional | Model used by the live complexity-routing classifier that decides scholarly escalation; defaults to `gpt-5.4-mini`. |
| `OPENAI_REQUEST_TIMEOUT_MS`, `OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_TEMPERATURE` | Optional | Runtime bounds and sampling settings for synthesis. |
| `TEXTLAB_ASSISTANT_DISABLE_LIVE` | Optional | Set to `1` to force local fallback even when an OpenAI key is present. |
| `AI_GATEWAY_API_KEY` | Optional | Enables Voyage rerank and the eval report judge through Vercel AI Gateway. |
| `RERANK_MODEL`, `RERANK_TIMEOUT_MS` | Optional | Rerank model and timeout overrides. |
| `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_TIMEOUT_MS` | Optional | Weekly eval judge model and per-attempt timeout (the judge retries transient provider errors, up to 3 attempts). |

Integration, acceptance, and eval scripts load `.env.test`; configure it from `.env.test.example` against a throwaway Neon branch. These commands write and delete test data.

## Commands

```bash
# Development
npm run dev
npm run build
npm run start

# Database
npm run db:migrate:deploy
npm run db:seed
npm run import:louw-nida
npm run import:open-bible
npm run import:macula-glosses
npm run embed:verses

# Verification
npm run lint
npx tsc --noEmit --pretty false
npm run test:unit
npm run test:coverage
npm run verify
npm run test:integration
npm run test:acceptance
npm run security:audit

# Evaluation
npm run eval:gate
npm run eval:report
npm run smoke:classifier
```

`npm run verify` runs lint, TypeScript, build, and coverage. The full release gate also includes integration tests, acceptance tests, security audit, and the eval gate.

## Evaluation Harness

Milestone 3 Phase 6 added a two-tier quality harness over `eval/dataset/golden-set.json`.

`npm run eval:gate` is the blocking deterministic gate. It is DB-only and does not require API keys. It checks type-aware retrieval quality, citation resolvability, and required lemma coverage.

`npm run eval:report` is the non-blocking hybrid quality report. It runs the full retrieval pipeline with semantic retrieval, synthesis, rerank, and LLM-as-judge faithfulness scoring when the relevant keys are present. It writes self-contained HTML and JSON output under `eval/output/`.

`npm run smoke:classifier` is a live, pre-merge smoke test for the LLM complexity classifier (`lib/ai/complexity.ts`): it exercises the exact production call (Responses API, strict JSON schema, reasoning effort "low", no retry) against the real model over a small fixed prompt set. It gates on the classifier **contract** and **always validates verdicts**: each prompt is tried first at the mandated 3 s production budget, and if that times out the verdict is still validated via a relaxed-timeout probe. It exits non-zero on a wrong verdict, a non-timeout API error (400 / bad JSON / missing key), or no verdict even under the relaxed probe. Calls that only completed over the 3 s budget are reported as a latency datapoint to re-check in a production-like network (in production a classifier timeout falls back to the deterministic score, and dev-box round-trip latency is not signal about the classifier itself). It requires `OPENAI_API_KEY`.

GitHub Actions automation is present and configured:

- `.github/workflows/eval-gate.yml` runs on pull requests and pushes to `main`.
- `.github/workflows/weekly-eval-report.yml` runs on a weekly schedule (Fridays) and via `workflow_dispatch`.

To enable those workflows in a fork or fresh deployment, configure the required eval database/API secrets and make `Eval Gate / gate` a required status check for protected branches.

The gate protects deterministic evidence retrieval and citation safety. The report monitors full hybrid-pipeline answer quality. Runtime hallucination protection remains the production grounding verifier.

## Current Follow-Ups

- **PostCSS advisory:** moderate upstream-blocked advisory tracked in `docs/security-register.md`; re-run `npm run security:audit` after Next.js upgrades.
- **Deep-mode fallback sizing unvalidated:** scholarly routing raises the deterministic-fallback answer's evidence ceiling to 12 passage calls plus a corpus-wide semantic pass; the resulting worst-case answer/markdown size has not been re-measured against the `generated-study-notes` caps. Tracked as hardening debt in `docs/security-register.md`.
- **Grounding prose sweep:** the Silence Protocol verifies structured `claims[]`; a future hardening pass should also detect unsupported inline prose citations.
- **Natural-language range parsing:** `Matthew 5:1-12` style ranges work; "from X to Y" / "X through Y" ranges remain a retrieval-planner follow-up.
- **Topical exact-verse fan-out:** decide whether explicit verse lookups with topic words should suppress extra topic searches.
- **Domain gate promotion:** domain recall is report-only until the domain golden set is fully validated and scoped.
- **Coverage headroom:** branch coverage is close to the current gate; targeted tests in assistant/search code should come before raising the branch threshold.
- **Developer onboarding:** add a focused guide for extending the assistant dispatch/retrieval-planner branch pattern.
- **Data expansion:** OT Hebrew/Aramaic, LXX, Strong's, speaker data, explicit alignment, broader query expansion, and a general multi-tool agent loop remain beyond Milestone 3.

## Smoke Path

1. Start the app and sign in through `/signin`.
2. Open `/read` and view John 1.
3. Click a Greek token to inspect morphology and domain metadata.
4. Open `/search`, try the keyword, lemma, morphology, and domain modes (the empty-state example chips are a quick way in), then follow a result reference into the reader.
5. Open `/assistant` and ask a scoped corpus question, such as `Show me every use of logos in John 1 and summarize the pattern.`
6. Review the retrieval trace and citations.
7. Save the generated note and export it as Markdown.
8. Run `npm run eval:gate` against the test database before treating retrieval changes as ready.

## Project Documentation

Start here:

- `docs/PROJECT_STATE.md` - current state snapshot, outstanding items, and logical next steps.
- `docs/HiFi-exegesis-nt-roadmap.md` - Milestone 3 roadmap, gap analysis, completed phases, and deferred scope.
- `docs/security-register.md` - accepted advisories, security exceptions, and operational hardening notes.
- `eval/dataset/golden-set.json` - curated eval questions and expected evidence.
- `eval/`, `scripts/eval-gate.ts`, and `scripts/eval-report.ts` - eval harness implementation and entry points.

Historical planning and implementation notes live under:

- `docs/archived/` (includes the closed `ui-review/` passes)
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

See `docs/README.md` for a map of the documentation layout.
