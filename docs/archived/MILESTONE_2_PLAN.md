# Milestone 2 Plan

## Summary

Milestone 2 expands TextLab Bible from a sample-passage MVP into an import-backed New Testament study slice. The goal is to keep the architecture simple and vertical-slice oriented while adding open Greek source imports, an open English substitute, larger passage navigation, paginated search, saved searches, and saved generated study notes.

## Key Changes

- Add import infrastructure for open Greek and English sources.
  - Use downloadable open Greek sources for SBLGNT-style text and MorphGNT-style morphology.
  - Use WEB as the open English text for milestone work.
  - Track imports with an `ImportRun` model so source, status, counts, and errors are visible.
- Extend persistence for user workflow.
  - Add `SavedSearch` for reusable keyword, lemma, and morphology searches.
  - Add `GeneratedStudyNote` for assistant answers saved as study note history.
- Improve reader and reference navigation.
  - Support imported New Testament books and chapters.
  - Keep the existing reader path working for seeded sample passages.
- Improve search.
  - Add pagination with `page`, `pageSize`, `mode`, `q`, `book`, `chapter`, and `matchMode`.
  - Default `pageSize` to 25 and cap it at 100.
  - Add save/list saved-search behavior on the search page.
- Improve assistant study flow.
  - Let generated assistant answers be saved as generated study notes.
  - Show saved generated note history in the assistant or notes workflow.

## Test Plan

- Add unit or integration coverage for import parsing and import-run status behavior.
- Add coverage for paginated search results, page-size bounds, and filtered searches.
- Add coverage for creating/listing saved searches.
- Add coverage for saving generated assistant notes.
- Run the existing verification sequence:
  - `npm run lint`
  - `npm run db:push`
  - `npm run db:seed`
  - `npm run build`
  - `npm run test:acceptance`

## Assumptions

- NET import is deferred because NET licensing and distribution requirements need a separate decision.
- WEB is acceptable as the milestone English text substitute.
- Hebrew, LXX, authentication, cloud sync, document export, and real OpenAI tool-calling remain out of scope for Milestone 2.
- The implementation should stay incremental: schema and import foundations first, then reader/search workflows, then assistant saved-note history, then verification.
