import { normalizeBook } from "@/lib/references";

export type NotesSort = "recent" | "canonical" | "title";

export type ParsedReferenceFilter = {
  book: string;
  chapter?: number;
};

export function parseNotesSort(input: string | undefined | null): NotesSort {
  if (input === "canonical" || input === "title") return input;
  return "recent";
}

// A note's canonical position comes from whichever of its two relations is set:
// verse-attached notes carry a `verse`, token-attached notes carry a `token`.
type CanonicalRef = { book: { order: number }; chapter: number; verse: number };

// Denormalized sort keys stored on the Note row so the database can order
// canonically without COALESCE-ing across the verse/token relations. Computed
// once when a note is created — the verse/token association is immutable
// (the PATCH route never re-points it) and the underlying reference data is
// fixed canon, so these never drift.
export type NoteCanonicalKey = {
  refBookOrder: number | null;
  refChapter: number | null;
  refVerse: number | null;
};

export function noteCanonicalKey(
  verse: CanonicalRef | null | undefined,
  token: CanonicalRef | null | undefined
): NoteCanonicalKey {
  const source = verse ?? token;
  return source
    ? { refBookOrder: source.book.order, refChapter: source.chapter, refVerse: source.verse }
    : { refBookOrder: null, refChapter: null, refVerse: null };
}

export function parseReferenceFilter(input: string): ParsedReferenceFilter | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.+?)(?:\s+(\d+))?$/);
  if (!match) return null;
  const bookCandidate = match[1].trim();
  if (!bookCandidate) return null;
  const normalized = normalizeBook(bookCandidate) ?? bookCandidate;
  const chapter = match[2] ? Number(match[2]) : undefined;
  return { book: normalized, chapter };
}
