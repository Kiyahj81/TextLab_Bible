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
