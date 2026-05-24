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
- Highlights scoped to a local user id (no auth yet) — verse-level on Greek tokens, word-level on English text
- **AI Study Assistant** at `/assistant`:
  - Retrieval-first dispatch over local corpus (important-words, lemma, morphology, passage, keyword fallback)
  - Live OpenAI synthesis when `OPENAI_API_KEY` is set; deterministic local fallback otherwise
  - Structured citations and `ToolTraceEntry[]` retrieval trace visible in the UI
  - Q&A history persisted to `AiSession` / `AiMessage` with typed JSON `metadata`
  - Markdown export of any generated answer
- Import tracking for open Bible text sources via the `ImportRun` table

### Design
The Reader uses an editorial-scholar aesthetic: Spectral display serif, Inter Tight UI sans, Gentium Plus for polytonic Greek (purpose-built diacritic positioning), a derived accent palette (`accent.50`–`900` from `#365f7e`), codex-style left-rule pattern, paper-grain background.

Not included yet: NET import, auth / multi-user, Hebrew Bible, LXX, cloud sync, scholarly-model escalation (Step 3), or PDF/DOCX/PPTX export.

## Setup

1. **Install dependencies:**

```bash
npm install
```

On Windows, if `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, prefix with `NODE_OPTIONS=--use-system-ca` (Bash) or `$env:NODE_OPTIONS="--use-system-ca"; ...` (PowerShell).

2. **Create an `.env` file:**

```bash
cp .env.example .env
```

- Set `DATABASE_URL` to a running PostgreSQL instance. The default in `.env.example` expects Postgres on `localhost:5433`.
- Set `OPENAI_API_KEY` to enable live assistant mode. Without it, the assistant gracefully falls back to local-only retrieval. Next.js reads system environment variables with higher precedence than `.env`, so a user/system-level `OPENAI_API_KEY` is also picked up automatically.

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
# 84 unit tests across 17 files (~5s)
npm run test:unit

# Playwright end-to-end suite — spins up its own dev server (~30s)
npm run test:acceptance
```

Full verification gate sequence (mirrors what's run before each milestone close):

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:unit
npm run test:acceptance
```

All five gates exit 0 on the current `main`.

## Open Text Imports

The project includes an import script for MorphGNT/SBLGNT-style Greek files and WEB USFM files. Imported runs are tracked in the `ImportRun` table.

Import MorphGNT directly from GitHub raw files:

```bash
npm run import:open-bible -- --morphgnt-url-base https://raw.githubusercontent.com/morphgnt/sblgnt/master
```

Import from local extracted folders:

```bash
npm run import:open-bible -- --morphgnt-dir ./data/sblgnt --web-usfm-dir ./data/web-usfm
```

The MorphGNT repository documents its columns and license at `https://github.com/morphgnt/sblgnt`. WEB USFM downloads are available from eBible at `https://ebible.org/details.php?id=engwebp`.

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
- `docs/superpowers/plans/` — execution plans for prior code review remediations
