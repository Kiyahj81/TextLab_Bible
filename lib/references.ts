export function formatReference(book: string, chapter: number, verse: number) {
  return `${book} ${chapter}:${verse}`;
}

export function normalizeBook(input?: string | null) {
  if (!input) return undefined;
  const value = input.trim();
  const lower = value.toLowerCase();

  if (["john", "jn", "jhn"].includes(lower)) return "John";
  if (["rom", "romans"].includes(lower)) return "Rom";

  return value;
}

export function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
