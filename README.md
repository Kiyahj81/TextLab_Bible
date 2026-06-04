# TextLab Bible

Milestone 2.5 of the TextLab Bible MVP: a single full-stack Next.js app delivering a corpus-backed reader, search, and **retrieval-first AI Study Assistant** over SBLGNT (Greek NT) and WEB (English NT). Built with Next.js 15, React 19, TypeScript, Prisma 6, and PostgreSQL.

## Current Scope

- **Reader** for the full SBLGNT Greek and WEB English NT in a parallel layout
  - Clickable Greek tokens with lemma and morphology popover
  - **Per-word English highlighting** with a 6-color palette + clear option, mirroring the Greek-token UX
  - Verse-jump input, prev/next chapter buttons at top and bottom of every passage
  - Greek / English / Parallel mode toggle (persisted to localStorage)
  - Last-visited passage automatically restored on bare `/read` visits
- **Search** in three modes (keyword / lemma / morphology)
  - **Keyword search uses full-text search** (PostgreSQL `tsvector`/GIN, `bible_simple` unaccent config): accent-insensitive Greek (λογος finds λόγος), whole-word lexeme matching rather than substring, multi-word AND queries, optional rank ordering
  - Match terms bolded inside result verses
  - In-input Search and Clear buttons; pagination; saved-search persistence (rename, delete)
- **Notes** index with keyword search, tag dropdown, reference filter, sort, and server-side pagination
- Highlights, notes, saved searches, and assistant sessions scoped to the signed-in user — verse-level on Greek tokens, word-level on English text
- **AI Study Assistant** at `/assistant`:
  - Deterministic-first retrieval: signal extraction (references, Greek words, topics, morphology, intent) → parallel corpus search → model synthesis with a single `getPassage` refinement step; signal extraction uses longest-first book aliases, strips parsed references/book aliases/morphology codes before topic extraction, maps stable entity topics (Jesus, Christ, God, Lord, Jerusalem) to Greek lemmas, and preserves known or quoted multi-word phrases for phrase-aware retrieval; the planner scopes word searches to the named book/chapter, returns whole chapters and cross-chapter passages in full (assembled from per-chapter fetches), and samples large corpus surveys with a true-count marker (e.g. `116 hit(s) … (91 more)`); passage assembly is bounded for safety (a per-corpus line ceiling plus pathological-span guards) and total evidence is capped so even large or malformed prompts stay within request and saved-note limits
  - **Hybrid semantic retrieval** on topical questions (Phase 4a): `searchSemantic` fuses pgvector KNN over WEB verse embeddings with keyword FTS via Reciprocal Rank Fusion, filters hits to the SBLGNT citation spine, filters embeddings to the current model, and expands each hit to an on-spine ±2 verse window. Requires `OPENAI_API_KEY` and the Phase 4a migrations applied; gracefully no-ops to deterministic retrieval otherwise. Ingestion: `npm run embed:verses` (idempotent, skips empty verses, and re-embeds when the embedding model or WEB text hash changes)
  - User-confirmed **scholarly-model escalation** — a "Use scholarly model" affordance re-runs the prompt on `gpt-5.4` (never automatic)
  - Live OpenAI synthesis when `OPENAI_API_KEY` is set; deterministic local fallback otherwise
  - **Grounding / Silence Protocol** — before any answer is returned or stored, the assistant verifies its citations against the SBLGNT. If a Greek quote falls below the 0.90 similarity threshold or a reference cannot be resolved, the answer is withheld and the UI displays "Withheld — insufficient textual evidence" rather than risk an unsupported claim. WEB (English) citations are a display aid only: a WEB mismatch appends a caveat but does not withhold.
  - Structured citations and `ToolTraceEntry[]` retrieval trace visible in the UI
  - Q&A history persisted to `AiSession` / `AiMessage` with typed JSON `metadata`
  - Markdown export of any generated answer
- Import tracking for open Bible text sources via the `ImportRun` table

### Design
The Reader uses an editorial-scholar aesthetic: Spectral display serif, Inter Tight UI sans, Gentium Plus for polytonic Greek (purpose-built diacritic positioning), a derived accent palette (`accent.50`–`900` from `#365f7e`), codex-style left-rule pattern, paper-grain background.

Not included yet: NET import, Hebrew Bible, LXX, cloud sync, or PDF/DOCX/PPTX export.

## Setup

1. **Install dependencies:**

```bash
npm install
```

On Windows, if `npm install`, `npm audit`, or any other Node tool fails with `unable to verify the first certificate` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, the cause is usually a local TLS-intercepting root (corporate proxy, AV HTTPS scanning such as Norton Web/Mail Shield) that lives in the Windows certificate store but isn't in Node's bundled CA list. Persist the fix at user scope with `setx NODE_OPTIONS "--use-system-ca"` (run once, then open a new shell), or set it ad-hoc per invocation via `NODE_OPTIONS=--use-system-ca` (Bash) / `$env:NODE_OPTIONS="--use-system-ca"; ...` (PowerShell). See `docs/security-register.md` for the `NODE_EXTRA_CA_CERTS` alternative.

2. **Create an `.env` file:**

```bash
cp .env.example .env
```

- Set `DATABASE_URL` to a running PostgreSQL instance. The default in `.env.example` expects Postgres on `localhost:5433`.
- Set `OPENAI_API_KEY` to enable live assistant mode. Without it, the assistant gracefully falls back to local-only retrieval. `OPENAI_MAX_OUTPUT_TOKENS` (default `2400`) caps any single response,, `OPENAI_REQUEST_TIMEOUT_MS` (default `120000`) bounds how long the client waits for a response — keep it large enough that a full answer at the configured token cap can finish generating, or the client abandons completed responses and shows the local fallback — and `OPENAI_TEMPERATURE` (default `0.3`, range `0`–`2`) sets the synthesis sampling temperature; lower values reduce sampling noise such as occasional foreign-language token leaks in the prose. Next.js reads system environment variables with higher precedence than `.env`, so a user/system-level `OPENAI_API_KEY` is also picked up automatically.
- `AI_GATEWAY_API_KEY` *(optional)* — enables Voyage rerank-2.5 reranking of the assistant's semantic results via Vercel AI Gateway. Unset → retrieval falls back to RRF ordering with no behavior change. `RERANK_MODEL` (default `voyage/rerank-2.5`) and `RERANK_TIMEOUT_MS` (default `3000`) tune it.
- Set `AUTH_SECRET` to a long random string. Required by Auth.js v5 in every environment — generate one with `openssl rand -base64 32`.
- Set `AUTH_URL` to the public URL of the app (`http://localhost:3000` in dev).
- For local sign-in without a real OAuth provider, set `AUTH_DEV_ENABLED=1`. The sign-in page lives at `/signin` and the global header carries a "Sign out" button once authenticated. **Never set `AUTH_DEV_ENABLED=1` in production.**
- Protected pages (`/read`, `/search`, `/notes`, `/assistant`) redirect unauthenticated visitors to `/signin`. Sign-out triggers the Sprint 4 JWT revocation watermark (`User.sessionsValidFrom`), so a replayed session cookie captured before sign-out is rejected with `401` on the next request.
- For GitHub OAuth in production, set both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

3. **Apply migrations and seed the corpus:**

```bash
npm run db:migrate:deploy
npm run db:seed
```

> **Use migrations, not `db:push`.** The Lexical FTS and vector-search features live in hand-written migrations that create `unaccent`, `bible_simple`, the **generated** `Verse.textSearch` column, `pgvector`, `VerseEmbedding`, and the embedding `textHash` column. `npm run db:push` is intentionally disabled because schema-push cannot recreate those SQL details safely; run `npm run db:migrate:deploy` to apply the checked-in migrations.

4. **Start the app:**

```bash
npm run dev
```

Open `http://localhost:3000/read`.

## Testing

```bash
# 200 unit tests across 28 files (~5s)
npm run test:unit

# Same suite with the v8 coverage gate (80% lines/statements over app/api + lib)
npm run test:coverage

# Real-Prisma integration tests for ownership + FK cascade.
# These write/delete data, so they run against an isolated test database —
# configure .env.test (cp .env.test.example .env.test) pointing at a Neon branch.
npm run test:integration

# Playwright end-to-end suite — signs in via dev credentials provider,
# then exercises reader/search/assistant/notes (~30s). Also uses .env.test.
npm run test:acceptance
```

> **Test database:** `npm run test:integration` and `npm run test:acceptance` load `.env.test`
> (gitignored) instead of `.env`, so they hit a throwaway **Neon branch** rather than your working
> database. Copy `.env.test.example` to `.env.test` and fill in the branch connection strings.

Verification gate (matches the `verify` npm script, runs lint + tsc + build + coverage):

```bash
npm run verify
```

`npm run verify` exits 0 on the current `main`. The full release gate adds `npm run test:integration`, `npm run test:acceptance`, and `npm run security:audit`.

## Open Text Imports

The project includes an import script for three Greek/English NT data sources. Each run is tracked in the `ImportRun` table.

> These data scripts (`import:open-bible`, `import:macula-glosses`, `embed:verses`) run through `tsx --env-file=.env`, so they read `DATABASE_URL` (and, for `embed:verses`, `OPENAI_API_KEY`) from your `.env`. Set those there before running, or pass a different file explicitly, e.g. `tsx --env-file=.env.test scripts/embed-verses.ts` to target the test branch. Already-set shell/system env vars are preserved.

| Source | Purpose | Provides |
|---|---|---|
| MorphGNT SBLGNT | Per-word Greek tokens + morphology | `Token` rows + `Verse.text` for the SBLGNT corpus |
| WEB USFM | English text | `Verse.text` for the WEB corpus |
| MACULA Greek (SBLGNT) | English glosses + lexical/morph augmentation | Updates `Token.gloss` on existing rows; **inserts tokens and verses for the Pericope Adulterae** (John 7:53–8:11), which MorphGNT omits per the SBL bracketed-text convention |

Full import (all three sources, from local files):

```bash
npm run import:open-bible -- \
  --morphgnt-url-base https://raw.githubusercontent.com/morphgnt/sblgnt/master \
  --web-usfm-dir ./data/web-usfm \
  --macula-greek-tsv ./data/macula-greek/macula-greek-SBLGNT.tsv
```

Individual sources:

```bash
# MorphGNT direct from GitHub
npm run import:open-bible -- --morphgnt-url-base https://raw.githubusercontent.com/morphgnt/sblgnt/master

# WEB only, from a local USFM directory
npm run import:open-bible -- --web-usfm-dir ./data/web-usfm

# MACULA Greek glosses only (default URL points at Clear-Bible main)
npm run import:macula-glosses
```

After the corpus is imported, generate or refresh the semantic-search embeddings (idempotent; requires `OPENAI_API_KEY` in `.env`). The script re-embeds only rows whose embedding is missing, whose model differs from `text-embedding-3-small`, or whose stored `textHash` no longer matches the current WEB verse text:

```bash
npm run embed:verses
```

Source repositories: MorphGNT at `https://github.com/morphgnt/sblgnt`, WEB USFM at `https://ebible.org/Scriptures/engwebp_usfm.zip` (the downloaded zip is checked in at the project root as `engwebp_usfm.zip`; unzipped contents live in `data/web-usfm/`), MACULA Greek at `https://github.com/Clear-Bible/macula-greek`.

### MACULA Pericope Adulterae overrides

MACULA's coverage of John 7:53–8:11 was added later than the core SBLGNT and is poorly punctuated upstream — many clause-final stops are missing, a few are wrong, and one row has `;;` embedded in the actual word column. `scripts/import-open-bible.ts` carries a `MACULA_OVERRIDES` table that patches each affected token's `text` and/or `after` field against Holmes 2010 SBL GNT before parsing. Overridden verses are force-refreshed on every import so override edits land on tokens that already exist in the DB. If Clear-Bible ever publishes a curated PA, drop the matching entries from the override table.

## Sample Acceptance Path

1. Open `/read`.
2. View John 1:1-5 in Greek and English.
3. Click `logos` / `λόγος` to see the morphology popover (`N-NSM` for John 1:1).
4. Use `Search lemma` to open lemma results at `/search?mode=lemma&q=λόγος&book=John` (40 hits).
5. Save the search, then add a note or highlight from the reader.
6. Open `/assistant` and ask: `Show me every use of λόγος in John 1 and summarize the pattern.`
7. Review the **Retrieval trace** panel — entries are structured as `searchLemma({"lemma":"λόγος","book":"John"})`.
8. Confirm the metadata bar shows `Live` (when `OPENAI_API_KEY` is set) or `Local fallback`.
9. Click **Save generated note**, then **Export Markdown** to download the study note.

## Project Documentation

- `docs/archived/MILESTONE_2_PLAN.md`, `docs/archived/MILESTONE_2_5_PLAN.md` — historical milestone planning
- `docs/PROJECT_STATE.md` — current state snapshot and logical next steps
- `docs/ui-review/pass-{1,2,3}-*.md` — three-pass UI review (functional bugs / layout / UX & design), 55 findings, 100% closed across PRs 1–11
- `docs/archived/security-testing-remediation-plan.md` — Phase 3.0 hardening plan (auth, validation, headers, coverage) — all four sprints landed
- `docs/security-register.md` — known security advisories with mitigations
- `docs/superpowers/plans/` — execution plans for prior code review remediations
