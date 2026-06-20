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
type CanonicallySortable = {
  updatedAt: Date;
  verse: CanonicalRef | null;
  token: CanonicalRef | null;
};

function effectiveRef(note: CanonicallySortable): { order: number; chapter: number; verse: number } {
  const source = note.verse ?? note.token;
  // A note with neither relation sorts last (mirrors Postgres NULLS LAST).
  return {
    order: source?.book.order ?? Number.POSITIVE_INFINITY,
    chapter: source?.chapter ?? Number.POSITIVE_INFINITY,
    verse: source?.verse ?? Number.POSITIVE_INFINITY
  };
}

// Canonical sort spans two relations, so Prisma's orderBy (which can only target
// one of `verse`/`token` at a time and would drop the other to NULL → NULLS LAST)
// can't express it. Sort in application code by the effective reference instead,
// so token- and verse-attached notes interleave by book/chapter/verse, with the
// most-recently updated note winning ties.
export function sortNotesCanonically<T extends CanonicallySortable>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    const ra = effectiveRef(a);
    const rb = effectiveRef(b);
    return (
      ra.order - rb.order ||
      ra.chapter - rb.chapter ||
      ra.verse - rb.verse ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  });
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
