# TextLab Bible MVP Spec

## Project name

**TextLab Bible**

---

## One-sentence concept

Build a simple AI-powered Bible text study app where users can read and search open biblical texts, run exact lemma and morphology searches, take notes and highlight passages, and ask an AI assistant questions that are grounded in the app’s biblical text database.

---

## Product positioning

TextLab Bible is **not** meant to be a Logos-style library platform.

It is a **Bible text lab**:

> A text-centered original-language study workspace where AI reasons from the biblical text itself, not from an invisible library or from model memory.

The app should prioritize:

- biblical text
- original-language morphology
- precise search
- transparent AI grounding
- user notes/highlights
- generated study and ministry outputs

---

# 1. MVP Goal

Build a working first version focused on the **Greek New Testament**.

The MVP should include:

1. **SBLGNT-style Greek New Testament text**
2. **MorphGNT-style morphology data**
3. **World English Bible (WEB) English translation**
4. **Bible reading interface**
5. **Greek word-click morphology popup**
6. **Keyword search**
7. **Lemma search**
8. **Morphology search**
9. **Notes and highlights**
10. **AI assistant that answers only from retrieved biblical text/search results**
11. **Cited AI responses**
12. **Markdown export for generated study notes**

Do not attempt to build the full product at first.

The first milestone should use **sample data only**.

---

# 2. Recommended Stack

Use:

```txt
Frontend: Next.js + TypeScript + React
Styling: Tailwind CSS
UI components: shadcn/ui if useful
Database: PostgreSQL
ORM: Prisma
Backend/API: Next.js API routes or server actions
Search: PostgreSQL full-text search for MVP
AI: OpenAI API
Auth: skip for first local MVP, or use a simple local user ID
Exports: Markdown first
```

Prefer keeping the MVP as a single full-stack Next.js app unless there is a strong reason to split out a separate backend.

---

# 3. Core Product Principle

The AI must not answer Bible questions from model memory.

The AI should use internal tools/functions that query the local Bible database first.

Every AI answer should include citations to:

```txt
Bible version
Book
Chapter
Verse
Optional word/token ID
Search query used
```

Example citation format:

```txt
Rom 3:21, SBLGNT
Rom 3:22, SBLGNT
Rom 4:3, SBLGNT
```

For MVP, citations can be simple textual references.

---

# 4. Data Sources

Prepare the app to ingest these datasets.

## 4.1 Greek New Testament

Use:

```txt
SBLGNT
MorphGNT SBLGNT
```

The text should be tokenized at word level with morphology and lemma data.

## 4.2 English Bible

Use:

```txt
World English Bible / WEB
```

For the MVP, the English text can be verse-level only. NET is deferred until licensing and distribution requirements are explicitly resolved.

Word-level alignment between Greek and English is **not required** for the MVP.

---

# 5. MVP Sample Data

For the first build, do not import the full Bible.

Seed only these passages:

```txt
John 1:1-5
Romans 3:21-26
Romans 4:1-8
Romans 12:1-8
```

Sample data should include:

- Greek verse text
- Greek token data
- lemma
- morphology code
- part of speech
- word index
- WEB English verse text

This allows the full vertical slice to work before building import scripts.

---

# 6. Database Schema

Create a Prisma schema roughly like this.

## 6.1 Corpus

Represents a biblical text source.

```prisma
model Corpus {
  id            String   @id @default(cuid())
  name          String
  abbreviation  String
  language      String
  license       String?
  sourceUrl     String?
  createdAt     DateTime @default(now())

  verses        Verse[]
  tokens        Token[]
}
```

Example corpora:

```txt
SBLGNT
MorphGNT
WEB
```

---

## 6.2 Book

```prisma
model Book {
  id        String @id @default(cuid())
  osisId    String @unique
  name      String
  order     Int

  verses    Verse[]
  tokens    Token[]
}
```

Examples:

```txt
Matt
Mark
Luke
John
Rom
```

---

## 6.3 Verse

```prisma
model Verse {
  id          String @id @default(cuid())
  corpusId    String
  bookId      String
  chapter     Int
  verse       Int
  text        String

  corpus      Corpus @relation(fields: [corpusId], references: [id])
  book        Book   @relation(fields: [bookId], references: [id])
  notes       Note[]
  highlights  Highlight[]

  @@unique([corpusId, bookId, chapter, verse])
  @@index([bookId, chapter, verse])
}
```

---

## 6.4 Token

Each original-language word/token.

```prisma
model Token {
  id              String @id @default(cuid())
  corpusId        String
  bookId          String
  chapter         Int
  verse           Int
  wordIndex       Int

  surface         String
  normalized      String?
  lemma           String?
  morphCode       String?
  partOfSpeech    String?
  gloss           String?

  corpus          Corpus @relation(fields: [corpusId], references: [id])
  book            Book   @relation(fields: [bookId], references: [id])
  notes           Note[]
  highlights      Highlight[]

  @@unique([corpusId, bookId, chapter, verse, wordIndex])
  @@index([lemma])
  @@index([morphCode])
  @@index([bookId, chapter, verse])
}
```

---

## 6.5 Note

Notes can attach to a verse or token.

```prisma
model Note {
  id        String   @id @default(cuid())
  userId    String
  verseId   String?
  tokenId   String?
  title     String?
  body      String
  tags      String[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  verse     Verse? @relation(fields: [verseId], references: [id])
  token     Token? @relation(fields: [tokenId], references: [id])
}
```

---

## 6.6 Highlight

```prisma
model Highlight {
  id        String   @id @default(cuid())
  userId    String
  verseId   String?
  tokenId   String?
  color     String
  createdAt DateTime @default(now())

  verse     Verse? @relation(fields: [verseId], references: [id])
  token     Token? @relation(fields: [tokenId], references: [id])
}
```

---

## 6.7 AiSession and AiMessage

```prisma
model AiSession {
  id        String   @id @default(cuid())
  userId    String
  title     String?
  createdAt DateTime @default(now())
  messages  AiMessage[]
}

model AiMessage {
  id          String   @id @default(cuid())
  sessionId   String
  role        String
  content     String
  citations   Json?
  createdAt   DateTime @default(now())

  session     AiSession @relation(fields: [sessionId], references: [id])
}
```

---

# 7. Main Screens

## 7.1 Reader Screen

Route:

```txt
/read
```

Features:

- Select book/chapter
- Show Greek SBLGNT and WEB side by side
- Each Greek word should be clickable
- Clicking a Greek word opens a morphology popup

The morphology popup should show:

- surface form
- lemma
- morphology code
- part of speech
- reference
- button: search lemma
- button: add note
- button: highlight

---

## 7.2 Search Screen

Route:

```txt
/search
```

Search modes:

```txt
Keyword
Lemma
Morphology
```

### Keyword Search

Search verse text.

Example queries:

```txt
kingdom
faith
righteousness
λόγος
```

### Lemma Search

Search original-language token lemmas.

Example queries:

```txt
δικαιοσύνη
πιστεύω
λόγος
```

Return:

```txt
Reference
Verse text
Matching token
Lemma
Morphology
Context
```

### Morphology Search

Search morphology code by exact or prefix match.

Example queries:

```txt
N-NSM
V-AAI
V-PAP
```

Return:

```txt
Reference
Token
Lemma
Morphology
Verse text
```

---

## 7.3 Notes Screen

Route:

```txt
/notes
```

Features:

- List all notes
- Filter by tag
- Filter by reference
- Edit note
- Delete note
- Click reference to open reader

---

## 7.4 AI Study Assistant Screen

Route:

```txt
/assistant
```

The assistant should support prompts like:

```txt
Show me every use of δικαιοσύνη in Romans and summarize the patterns.
Find every imperative in Romans 12.
Create a study note on John 1:1-5 using only SBLGNT and WEB.
Compare how WEB translates λόγος in John.
Create a table of every occurrence of πιστεύω in John.
```

The assistant must use database retrieval before answering.

---

# 8. AI Tool Functions

Implement internal server-side functions that the AI layer can call.

## 8.1 getPassage

Input:

```ts
{
  corpus: "SBLGNT" | "WEB";
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
}
```

Output:

```ts
{
  corpus: string;
  references: Array<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
}
```

---

## 8.2 searchKeyword

Input:

```ts
{
  corpus?: string;
  query: string;
  book?: string;
  chapter?: number;
}
```

Output:

```ts
{
  query: string;
  results: Array<{
    corpus: string;
    reference: string;
    text: string;
  }>;
}
```

---

## 8.3 searchLemma

Input:

```ts
{
  lemma: string;
  corpus?: "SBLGNT";
  book?: string;
}
```

Output:

```ts
{
  lemma: string;
  count: number;
  results: Array<{
    reference: string;
    surface: string;
    lemma: string;
    morphCode: string;
    verseText: string;
  }>;
}
```

---

## 8.4 searchMorphology

Input:

```ts
{
  morphCode: string;
  matchMode: "exact" | "prefix";
  corpus?: "SBLGNT";
  book?: string;
}
```

Output:

```ts
{
  morphCode: string;
  count: number;
  results: Array<{
    reference: string;
    surface: string;
    lemma: string;
    morphCode: string;
    verseText: string;
  }>;
}
```

---

## 8.5 createMarkdownExport

Input:

```ts
{
  title: string;
  body: string;
  citations: Array<{
    reference: string;
    corpus: string;
  }>;
}
```

Output:

```ts
{
  markdown: string;
}
```

---

# 9. AI Behavior Rules

Create a system prompt for the assistant like this:

```txt
You are an AI Bible study assistant inside TextLab Bible.

You must ground your answers in the biblical text data available through tools.

Do not answer biblical-text questions from general memory when a tool can retrieve the relevant biblical text.

When asked about a word, lemma, morphology pattern, passage, theme, or translation, first call the relevant search or passage tool.

Cite every textual claim with book, chapter, verse, and corpus.

Clearly distinguish:
1. textual observations,
2. interpretive suggestions,
3. theological/application reflections.

Do not claim that a Greek or Hebrew word “means” something unless the claim is supported by the retrieved usage data.

For word studies, prefer:
- occurrences,
- distribution,
- immediate context,
- grammatical forms,
- common translation patterns,
- cautious summary.

Never invent lexicon entries, manuscript evidence, or scholarly citations.
```

---

# 10. MVP User Stories

## 10.1 Reader

```txt
As a user, I can open John 1 and view SBLGNT and WEB side by side.

As a user, I can click λόγος and see its lemma, morphology, and reference.

As a user, I can click “search lemma” from the word popup and see all occurrences of λόγος.
```

---

## 10.2 Search

```txt
As a user, I can search for a Greek lemma and get all matching verses.

As a user, I can search for a morphology code and get all matching tokens.

As a user, I can search English WEB text for a keyword.

As a user, I can filter searches by book.
```

---

## 10.3 Notes and Highlights

```txt
As a user, I can add a note to a verse.

As a user, I can add a note to a Greek word/token.

As a user, I can highlight a verse.

As a user, I can view all my notes in one place.
```

---

## 10.4 AI Assistant

```txt
As a user, I can ask the assistant for every occurrence of δικαιοσύνη in Romans.

As a user, I can ask the assistant to create a table of those results.

As a user, I can ask the assistant to summarize patterns from the retrieved results.

As a user, I can export the generated study note to Markdown.
```

---

# 11. Implementation Milestones

## 11.1 Milestone 1: Working Vertical Slice with Sample Data

Build the app with mocked/small sample data first.

Use sample data from:

```txt
John 1:1-5
Romans 3:21-26
Romans 4:1-8
Romans 12:1-8
```

Milestone 1 should include:

- Next.js app bootstrapped
- Prisma/PostgreSQL configured
- Corpus/Book/Verse/Token/Note/Highlight schema created
- Seed script with sample SBLGNT/MorphGNT/WEB data
- Reader page
- Word-click popup
- Lemma search
- Morphology search
- Basic notes
- Basic highlights
- AI assistant using internal search functions
- Markdown export

---

## 11.2 Milestone 2: Full Greek NT Import

After sample data works:

- Add import scripts for full SBLGNT/MorphGNT
- Add import scripts for WEB
- Add better reference navigation
- Add search result pagination
- Add saved searches
- Add generated study note history

---

## 11.3 Milestone 3: Additional Corpora

Add more corpora later:

- OSHB Hebrew Bible
- Hebrew morphology search
- NET with Full Notes if licensing and distribution requirements are resolved
- Spanish open Bible text
- German open Bible text

Do not add these until the Greek NT MVP is stable.

---

# 12. Suggested Project Folder Structure

```txt
textlab-bible/
  app/
    read/
      page.tsx
    search/
      page.tsx
    notes/
      page.tsx
    assistant/
      page.tsx
    api/
      search/
      ai/
      notes/
      highlights/
  components/
    BibleReader.tsx
    VerseView.tsx
    Token.tsx
    MorphologyPopover.tsx
    SearchPanel.tsx
    SearchResults.tsx
    NotesPanel.tsx
    AiAssistant.tsx
    CitationList.tsx
  lib/
    db.ts
    references.ts
    search.ts
    ai/
      systemPrompt.ts
      tools.ts
      assistant.ts
    export/
      markdown.ts
  prisma/
    schema.prisma
    seed.ts
  scripts/
    import-sblgnt.ts
    import-morphgnt.ts
    import-open-bible.ts
  data/
    sample/
      sblgnt-john1.json
      morphgnt-john1.json
      web-john1.json
  README.md
```

---

# 13. Acceptance Criteria

The MVP is successful when all of this works:

```txt
1. User can read John 1 in Greek and English.
2. User can click Greek words and see morphology.
3. User can search for lemma λόγος and get matching results.
4. User can search a morphology code and get matching tokens.
5. User can add a note to John 1:1.
6. User can highlight John 1:1.
7. User can ask the AI: “Show me every use of λόγος in John 1 and summarize the pattern.”
8. The AI retrieves actual database results before answering.
9. The AI answer cites verses.
10. User can export the answer as Markdown.
```

---

# 14. Non-Goals for MVP

Do **not** build these in the first milestone:

- full Hebrew Bible
- full LXX
- Spanish/German translations
- commercial Bible translations
- lexicon system
- commentary library
- manuscript apparatus
- syntax tree searching
- full user authentication
- mobile app
- PDF/DOCX/PPTX export
- sermon manuscript generator
- collaborative notes
- cloud sync
- payment system

Those can be later milestones.

---

# 15. Future Expansion Ideas

After MVP stability, consider adding:

## 15.1 Hebrew Bible

- OSHB
- Hebrew lemma search
- Hebrew morphology search
- Hebrew word-click popups
- Hebrew-English parallel view

## 15.2 Septuagint

- CCAT/CATSS if non-commercial licensing fits
- Greek OT lemma/morphology search
- Hebrew-LXX comparison tools

## 15.3 Open Translations

Add open English, Spanish, and German texts.

Track license metadata carefully for each corpus.

## 15.4 Artifact Generation

Add export options:

- Markdown
- PDF
- DOCX
- PPTX
- spreadsheets
- lesson plans
- sermon outlines
- handouts
- tables
- charts
- graphs

## 15.5 Advanced AI Workflows

Possible workflows:

- word study
- theme study
- passage study
- translation comparison
- sermon prep
- Sunday school lesson
- devotional generation
- Bible study handout
- morphology worksheet
- vocabulary list
- passage observation table

---

# 16. Guardrails Against AI Hallucination

The AI assistant must follow these principles:

1. **Database first**
   - The database is the source of truth.
   - AI retrieves before it explains.

2. **Cite every textual claim**
   - Use book, chapter, verse, and corpus.

3. **Separate observation from interpretation**
   - Textual observation
   - Interpretive suggestion
   - Application/reflection

4. **No invented lexicon claims**
   - Do not invent lexical definitions.
   - Do not claim scholarly consensus unless a source is provided.

5. **No invented manuscript claims**
   - Do not discuss textual variants unless the app has apparatus data.

6. **Show search trail where possible**
   - Display the search type, query, and corpus used.

---

# 17. Example AI Interactions

## 17.1 Lemma Study

User:

```txt
Show me every use of δικαιοσύνη in Romans and summarize the patterns.
```

Assistant should:

1. Call `searchLemma({ lemma: "δικαιοσύνη", book: "Rom" })`
2. Return a table of occurrences.
3. Summarize patterns from the retrieved results.
4. Cite each claim.

---

## 17.2 Morphology Search

User:

```txt
Find every imperative in Romans 12.
```

Assistant should:

1. Call `searchMorphology` with the relevant morphology pattern.
2. Filter to Romans 12.
3. Return a table of matching forms.
4. Summarize what the imperatives emphasize.
5. Cite references.

---

## 17.3 Passage Study

User:

```txt
Create a study note on John 1:1-5 using only SBLGNT and WEB.
```

Assistant should:

1. Call `getPassage` for John 1:1-5 in SBLGNT.
2. Call `getPassage` for John 1:1-5 in WEB.
3. Produce a study note.
4. Separate observations from interpretation/application.
5. Cite the passage.

---

## 17.4 Translation Comparison

User:

```txt
Compare how WEB translates λόγος in John 1.
```

Assistant should:

1. Search the Greek lemma λόγος in John 1.
2. Retrieve the corresponding WEB verses.
3. Compare the Greek occurrences and English rendering.
4. Avoid making claims beyond the available data.

---

# 18. Codex Task Prompt

Copy this into Codex:

```txt
Build an MVP called TextLab Bible.

This is a Bible text-focused study app, not a library app. The first MVP should focus on the Greek New Testament with SBLGNT-style Greek text, MorphGNT-style morphology, and WEB English text. Use sample data first rather than full corpus imports.

Use Next.js, TypeScript, React, Tailwind, Prisma, and PostgreSQL. Keep it as a single full-stack Next.js app unless there is a strong reason to split the backend.

Core requirements:

1. Create a Prisma schema with Corpus, Book, Verse, Token, Note, Highlight, AiSession, and AiMessage models.
2. Create seed data for John 1:1-5, Romans 3:21-26, Romans 4:1-8, and Romans 12:1-8.
3. Include Greek token data with surface form, lemma, morphology code, part of speech, book, chapter, verse, and word index.
4. Include WEB English verse text for the same sample passages.
5. Build a /read page with side-by-side Greek and English text.
6. Make Greek words clickable.
7. On Greek word click, show a morphology popover with surface, lemma, morphology, part of speech, and reference.
8. Add buttons in the popover for “search lemma,” “add note,” and “highlight.”
9. Build a /search page with keyword, lemma, and morphology search modes.
10. Lemma search should search Token.lemma.
11. Morphology search should search Token.morphCode, supporting exact and prefix matching.
12. Keyword search should search Verse.text.
13. Build notes and highlights, attached either to verses or tokens.
14. Build a /notes page listing all notes.
15. Build a /assistant page.
16. The assistant must use internal search/get-passage functions before answering Bible-text questions.
17. Implement these server-side functions:
    - getPassage
    - searchKeyword
    - searchLemma
    - searchMorphology
    - createMarkdownExport
18. Create an AI system prompt that forbids answering biblical-text questions from model memory when the database can be searched.
19. AI answers should cite book, chapter, verse, and corpus.
20. Implement Markdown export for generated AI study notes.

Important principle:

The database is the source of truth. The AI should retrieve biblical text/search results first, then summarize and explain. Do not let the AI invent lexical claims, manuscript claims, or scholarly citations.

Prioritize a working vertical slice over completeness. The MVP is complete when I can:
- open /read,
- view John 1:1-5 in Greek and English,
- click λόγος,
- see lemma and morphology,
- search lemma λόγος,
- ask the assistant to summarize λόγος in John 1,
- see cited results,
- save/export the answer as Markdown.
```

---

# 19. Suggested Follow-Up Codex Tasks

After Codex creates the initial skeleton, give it smaller follow-up prompts.

## Task 1: Improve Reader UI

```txt
Improve the /read page layout. Make the Greek and English columns readable, add book/chapter selectors, improve spacing, and make clicked Greek tokens visually obvious. Preserve existing functionality.
```

## Task 2: Improve Morphology Popup

```txt
Improve the morphology popup. Show surface form, lemma, morphology code, part of speech, reference, and action buttons. Add a short human-readable explanation of the morphology code if possible.
```

## Task 3: Add Search Pagination

```txt
Add pagination to lemma, morphology, and keyword search results. Keep the API response shape stable.
```

## Task 4: Add Full MorphGNT Import Script

```txt
Write an import script for full MorphGNT SBLGNT data. It should parse the source format, create Book/Verse/Token rows, and preserve word order, surface form, lemma, and morphology code. Do not overwrite existing notes/highlights.
```

## Task 5: Add WEB Import Script

```txt
Write an import script for WEB USFM data. It should import verse-level text into the Verse table under the WEB corpus. Preserve book/chapter/verse references and strip USFM study tags from display text.
```

## Task 6: Improve AI Citations

```txt
Improve the assistant so every generated answer includes a structured citation list. Each citation should include corpus, book, chapter, verse, and the search function that retrieved it.
```

## Task 7: Add Saved AI Study Notes

```txt
Allow users to save an AI-generated answer as a note. The note should preserve title, body, citations, and related passage references.
```

---

# 20. Summary

The MVP should prove one core workflow:

```txt
Read Greek + English
Click a Greek word
See morphology
Search by lemma/morphology
Ask the AI a question
AI retrieves actual text data
AI answers with citations
User saves or exports the result
```

That vertical slice is the foundation for the larger product.

Once this works, the app can expand to Hebrew, LXX, Spanish, German, charts, documents, decks, and more advanced AI study workflows.
