import { bookName } from "@/lib/references";

export function scopeSuffix(book: string, chapter?: number): string {
  if (!book) return "";
  return ` in ${bookName(book)}${chapter ? ` ${chapter}` : ""}`;
}

export function querySearchLabel(mode: string, query: string, book: string, chapter?: number): string {
  return `${mode} "${query}"${scopeSuffix(book, chapter)}`;
}
