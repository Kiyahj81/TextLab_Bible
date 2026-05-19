# TextLab Bible

Milestone 1 implementation for the TextLab Bible MVP. This is a single full-stack Next.js app using Prisma and PostgreSQL with sample passages only.

## Current Scope

- Reader for seeded SBLGNT-style Greek and NET-style English sample verses
- Clickable Greek tokens with lemma and morphology popup
- Keyword, lemma, and morphology search
- Basic notes and highlights with a local user id
- Retrieval-first assistant route with citations and Markdown export

Not included yet: full corpus imports, auth, Hebrew Bible, LXX, cloud sync, or PDF/DOCX/PPTX export.

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

## Sample Acceptance Path

1. Open `/read`.
2. View John 1:1-5 in Greek and English.
3. Click `λόγος`.
4. Use `Search lemma` to open lemma results.
5. Add a note or highlight from the reader.
6. Open `/assistant` and ask: `Show me every use of λόγος in John 1 and summarize the pattern.`
7. Review the retrieval trace, cited answer, and Markdown export.
