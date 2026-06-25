# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For cross-agent repository guidance, see [AGENTS.md](AGENTS.md); this file adds Claude Code-specific expanded context.

## Documentation maintenance (do this after major changes)

Check the following files: README.md and docs/PROJECT_STATE.md to ensure that they are up to date after major changes to this project. For README.md, ensure that it reads as one coherent and unified document that anyone new to the project can understand. Maintain the current structure and format, but update the content to be accurate and up to date. For PROJECT_STATE.md, ensure that it is up to date with the latest changes to the project.

Check docs/security-register.md for known security advisories, exceptions, and outstanding hardening debt. Add new ones as discovered. Update whenever an advisory is accepted, mitigated, or closed.

## Project overview

TextLab Bible is a full-stack New Testament Greek exegesis app (Next.js App Router) with a corpus-backed reader, segmented search, notes, and a **retrieval-first** AI Study Assistant. Corpus scope is the NT-Greek subset: SBLGNT Greek, WEB English, MorphGNT morphology, MACULA glosses, and UBS Louw-Nida semantic domains.

**SBLGNT is the citation/grounding spine** — it is the authority for any cited evidence. WEB English is a display/search aid only and may not align with the Greek; never treat it as citation authority. Off-spine results render as plain text rather than reader links.

`docs/PROJECT_STATE.md` is the authoritative current-state snapshot; `docs/HiFi-exegesis-nt-roadmap.md` holds the Milestone 3 roadmap and deferred scope. Read README.md for the full product/architecture tour before large changes.

## Commands

```bash
# Dev / build
npm run dev            # next dev (http://localhost:3000)
npm run build          # prisma generate && next build
npm run start

# Verification (the local gate)
npm run lint                       # eslint, --max-warnings=0
npx tsc --noEmit --pretty false    # type check
npm run test:unit                  # vitest unit suite (jsdom/node, no DB)
npm run test:coverage              # unit + v8 coverage gate (80/80/75/65)
npm run verify                     # lint + tsc + build + test:coverage

# DB-backed suites (need .env.test → throwaway Neon branch; they write+delete data)
npm run test:integration           # real-Prisma ownership/FK suite
npm run test:acceptance            # Playwright end-to-end (signs in via dev creds)
npm run eval:gate                  # blocking deterministic eval gate (DB-only, no API key)
npm run eval:report                # non-blocking hybrid quality report (needs API keys)

npm run security:audit             # npm audit --audit-level=low

# Database (migrations only — db:push is intentionally disabled)
npm run db:migrate:deploy          # apply handwritten SQL migrations
npm run db:seed                    # minimal local sample dataset
npm run import:louw-nida           # import LN reference table
npm run import:open-bible          # full NT corpus import (see README for args)
npm run import:macula-glosses
npm run embed:verses               # generate pgvector embeddings (needs OPENAI_API_KEY)
```

### Running a single test

Unit tests use Vitest; pass a filename substring (and/or `-t` for a test-name pattern):

```bash
npm run test:unit -- references            # files matching "references"
npm run test:unit -- tests/unit/lib/ai/grounding.test.ts -t "SBLGNT"
npx vitest run tests/unit/lib/search-keyword.test.ts
```

Integration tests run through a separate config and require a reachable `.env.test` DB; some also need API keys (e.g. `semantic-search.test.ts` gates on `OPENAI_API_KEY`, and its rerank blocks on `AI_GATEWAY_API_KEY`). Each suite self-skips when its required env vars are unset:

```bash
npm run test:integration -- louw-nida
```

## Critical conventions / gotchas

- **Migrations, not `db:push`.** `db:push` exits with an error on purpose. FTS/vector features (`unaccent`, `bible_simple`/`bible_english` configs, generated `tsvector` columns, GIN indexes, `pgvector`, `VerseEmbedding`) live in **handwritten SQL migrations** under `prisma/migrations/`. `prisma migrate dev` false-drifts here (autocrlf checksums) — hand-author new migration folders and apply with `npm run db:migrate:deploy`.
- **Windows TLS.** Every npm script bakes in `NODE_OPTIONS=--use-system-ca` via `cross-env`, so no shell prefix is needed. The one exception is the first `npm install` (runs before scripts apply the flag) — if it fails with `unable to verify the first certificate`, set `NODE_OPTIONS=--use-system-ca` in the shell first.
- **Three env files.** `.env` for dev/runtime; `.env.test` (from `.env.test.example`, pointed at a throwaway Neon branch) for `test:integration`, `test:acceptance`, `eval:gate`, and `eval:report`. Those test/eval commands **write and delete data** — never point them at prod.
- **Coverage gate is server-side only:** v8 over `app/api/**` + `lib/**` at lines 80 / statements 80 / functions 75 / branches 65 (`vitest.config.ts`). Branch coverage sits just above the gate — add targeted branch tests before raising it. UI components/pages/CLI scripts are covered by the acceptance suite, not the line gate.
- **Acceptance test must stay in sync with the corpus.** Assertions are pinned to exact corpus counts; retrieval/search changes that move counts require updating `scripts/acceptance-test.js` (this is not caught by `npm run verify`).
- **Don't lower eval/CI thresholds to pass** — fix the golden set or the measurement instead. The eval gate is type-aware (it only hard-gates metrics that are meaningful for each query type).
- The eval **gate** (`scripts/eval-gate.ts`) is the blocking deterministic check (no API keys); the eval **report** (`scripts/eval-report.ts`) is the non-blocking hybrid-pipeline + LLM-judge quality monitor.

## Architecture (big picture)

Next.js App Router routes live under `app/`: `/read`, `/search`, `/assistant`, `/notes`, `/signin`, and `app/api/*` server endpoints. The root route redirects to `/read`. Protected app pages and API routes are auth-gated (Auth.js v5 JWT sessions with a DB-backed revocation watermark; mutations also enforce same-origin + zod validation + body-size caps); `/signin` and the `/api/auth/*` catch-all are the public exceptions — unauthenticated visits to protected pages redirect to `/signin`.

**Search / reader data layer.** `lib/search.ts` is a thin facade re-exporting the real implementations in `lib/search/{shared,reader,keyword,tokens,domain,semantic,semanticIndex,rrf,rerank}.ts`. Keyword search is PostgreSQL FTS via raw SQL (`websearch_to_tsquery`): WEB rows use `bible_english` (Snowball stemming, no stopword dropping), Greek rows use `bible_simple` (accent-insensitive, whole-lexeme). Morphology queries are normalized from Robinson order to the stored MorphGNT scheme via `lib/morphology.ts` — this decoder/normalizer is shared by both the `/search` UI and the assistant's retrieval planner, so changes there affect both. Other shared helpers: `lib/references.ts` (`parseReference`, `readerHref`), `lib/louwNida.ts`, `lib/searchLabel.ts`.

**Assistant pipeline (deliberately retrieval-first; deterministic by default).** `lib/ai/assistant.ts` orchestrates: `routeAssistantPrompt` (model role + user-confirmed scholarly escalation) → `extractSignals` (`lib/ai/signals.ts`) → `buildPlan`/`runRetrievalPlan` (`lib/ai/retrievalPlanner.ts`, a bounded set of DB-backed passage/lemma/keyword/morphology/domain calls) → optional `semanticCall` (pgvector KNN fused with FTS via RRF, gated on `OPENAI_API_KEY`) → optional Voyage rerank through Vercel AI Gateway (gated on `AI_GATEWAY_API_KEY`) → `synthesizeWithRefinement` (`lib/ai/synthesis.ts`, returns structured `answer` + `claims[]`) → `verifyGrounding` (`lib/ai/grounding.ts`). Every external step degrades gracefully to deterministic local retrieval when its key is unset. Grounding is the Silence Protocol: each claim's cited reference is resolved and Greek quotes are fuzzy-matched against the real SBLGNT verse; a failing Greek match → the structured **withheld** refusal is stored, never the draft. WEB mismatches only append a caveat. Deterministic fallback paths are grounded by construction.

**Persistence.** Prisma 6 over PostgreSQL (`prisma/schema.prisma`, `prisma/migrations/*`). Maintainer dev + test use Neon branches (`DATABASE_URL` pooled at runtime, `DIRECT_URL` direct for migrations). The reader read path wraps queries in `withDbRetry` (`lib/db-retry.ts`) to survive Neon cold-start/idle-suspend (`P1017`).

**Evaluation.** `eval/*` (gate, report, judge, metrics, runner, thresholds) over `eval/dataset/golden-set.json`. `.github/workflows/eval-gate.yml` runs on PRs/pushes to `main` (required status check `Eval Gate / gate`); `weekly-eval-report.yml` runs Fridays + `workflow_dispatch`.

## Stack

Next.js 15 / React 19 / TypeScript 5.8 · Prisma 6 / PostgreSQL (pgvector) · Auth.js v5 beta + `@auth/prisma-adapter` · OpenAI Node SDK v4 + AI SDK v6 (Vercel AI Gateway for rerank/judge) · Vitest 4 + Testing Library + jsdom · Playwright · Tailwind 3 · zod 3. Node `>=22.15`.

## Repo conventions worth knowing

- `main` is protected by a GitHub ruleset: PR required, `gate` status check must pass (strict/up-to-date), force-push/deletion blocked — you cannot push directly to `main`. Self-merge is allowed (0 approvals required).
- Commit/PR co-author trailer must be `Claude Opus 4.8 (1M context)`.
- Historical planning/spec/plan notes live under `docs/archived/`, `docs/superpowers/specs/`, and `docs/superpowers/plans/`; `docs/README.md` maps the docs layout.
