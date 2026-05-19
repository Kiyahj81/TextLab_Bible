# TextLab Bible

Milestone 2 implementation for the TextLab Bible MVP. This is a single full-stack Next.js app using Prisma and PostgreSQL with sample passages, import infrastructure, saved searches, and generated study-note history.

## Current Scope

- Reader for seeded SBLGNT-style Greek and WEB English sample verses
- Clickable Greek tokens with lemma and morphology popup
- Keyword, lemma, and morphology search with pagination and saved searches
- Basic notes and highlights with a local user id
- Retrieval-first assistant route with citations, Markdown export, and saved generated study notes
- Import tracking for open Bible text sources

Not included yet: NET import, auth, Hebrew Bible, LXX, cloud sync, or PDF/DOCX/PPTX export.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create an `.env` file:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL` to a running PostgreSQL database.

4. Create tables and seed sample data:

```bash
npm run db:push
npm run db:seed
```

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000/read`.

## Open Text Imports

Milestone 2 includes an import script for MorphGNT/SBLGNT-style Greek files and WEB USFM files. Imported runs are tracked in the `ImportRun` table.

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
3. Click `logos` / `λόγος`.
4. Use `Search lemma` to open lemma results.
5. Save the search, then add a note or highlight from the reader.
6. Open `/assistant` and ask: `Show me every use of λόγος in John 1 and summarize the pattern.`
7. Review the retrieval trace, cited answer, Markdown export, and save the generated note.
