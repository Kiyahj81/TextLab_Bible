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
  - Match terms bolded inside result verses
  - In-input Search and Clear buttons; pagination; saved-search persistence (rename, delete)
- **Notes** index with keyword search, tag dropdown, reference filter, sort, and server-side pagination
- Highlights, notes, saved searches, and assistant sessions scoped to the signed-in user — verse-level on Greek tokens, word-level on English text
- **AI Study Assistant** at `/assistant`:
  - Retrieval-first dispatch over local corpus (important-words, lemma, morphology, passage, keyword fallback)
  - Live OpenAI synthesis when `OPENAI_API_KEY` is set; deterministic local fallback otherwise
  - Structured citations and `ToolTraceEntry[]` retrieval trace visible in the UI
  - Q&A history persisted to `AiSession` / `AiMessage` with typed JSON `metadata`
  - Markdown export of any generated answer
- Import tracking for open Bible text sources via the `ImportRun` table

### Design
The Reader uses an editorial-scholar aesthetic: Spectral display serif, Inter Tight UI sans, Gentium Plus for polytonic Greek (purpose-built diacritic positioning), a derived accent palette (`accent.50`–`900` from `#365f7e`), codex-style left-rule pattern, paper-grain background.

Not included yet: NET import, Hebrew Bible, LXX, cloud sync, scholarly-model escalation (Step 3), or PDF/DOCX/PPTX export.

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
- Set `OPENAI_API_KEY` to enable live assistant mode. Without it, the assistant gracefully falls back to local-only retrieval. `OPENAI_MAX_OUTPUT_TOKENS` (default `1200`) caps any single response. Next.js reads system environment variables with higher precedence than `.env`, so a user/system-level `OPENAI_API_KEY` is also picked up automatically.
- Set `AUTH_SECRET` to a long random string. Required by Auth.js v5 in every environment — generate one with `openssl rand -base64 32`.
- Set `AUTH_URL` to the public URL of the app (`http://localhost:3000` in dev).
- For local sign-in without a real OAuth provider, set `AUTH_DEV_ENABLED=1`. The sign-in page lives at `/signin` and the global header carries a "Sign out" button once authenticated. **Never set `AUTH_DEV_ENABLED=1` in production.**
- Protected pages (`/read`, `/search`, `/notes`, `/assistant`) redirect unauthenticated visitors to `/signin`. Sign-out triggers the Sprint 4 JWT revocation watermark (`User.sessionsValidFrom`), so a replayed session cookie captured before sign-out is rejected with `401` on the next request.
- For GitHub OAuth in production, set both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

3. **Apply migrations and seed the corpus:**

```bash
npm run db:migrate
npm run db:seed
```

(`npm run db:push` is also available for throwaway dev databases that skip migrations.)

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

# 7 real-Prisma integration tests for ownership + FK cascade (needs Docker / Postgres)
npm run test:integration

# Playwright end-to-end suite — signs in via dev credentials provider,
# then exercises reader/search/assistant/notes (~30s, needs Docker / Postgres)
npm run test:acceptance
```

Verification gate (matches the `verify` npm script, runs lint + tsc + build + coverage):

```bash
npm run verify
```

`npm run verify` exits 0 on the current `main`. The full Phase 3.0 release gate adds `npm run test:integration`, `npm run test:acceptance`, and `npm run security:audit`.

## Open Text Imports

The project includes an import script for three Greek/English NT data sources. Each run is tracked in the `ImportRun` table.

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
- `docs/security-testing-remediation-plan.md` — Phase 3.0 hardening plan (auth, validation, headers, coverage) — all four sprints landed
- `docs/security-register.md` — known security advisories with mitigations
- `docs/superpowers/plans/` — execution plans for prior code review remediations
