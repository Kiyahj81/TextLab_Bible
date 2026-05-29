export function formatReference(book: string, chapter: number, verse: number) {
  return `${book} ${chapter}:${verse}`;
}

export const ntBooks = [
  { osisId: "Matt", name: "Matthew", order: 40, aliases: ["matt", "matthew", "mt"] },
  { osisId: "Mark", name: "Mark", order: 41, aliases: ["mark", "mk"] },
  { osisId: "Luke", name: "Luke", order: 42, aliases: ["luke", "lk"] },
  { osisId: "John", name: "John", order: 43, aliases: ["john", "jn", "jhn"] },
  { osisId: "Acts", name: "Acts", order: 44, aliases: ["acts", "act"] },
  { osisId: "Rom", name: "Romans", order: 45, aliases: ["rom", "romans"] },
  { osisId: "1Cor", name: "1 Corinthians", order: 46, aliases: ["1cor", "1 cor", "1 corinthians", "first corinthians"] },
  { osisId: "2Cor", name: "2 Corinthians", order: 47, aliases: ["2cor", "2 cor", "2 corinthians", "second corinthians"] },
  { osisId: "Gal", name: "Galatians", order: 48, aliases: ["gal", "galatians"] },
  { osisId: "Eph", name: "Ephesians", order: 49, aliases: ["eph", "ephesians"] },
  { osisId: "Phil", name: "Philippians", order: 50, aliases: ["phil", "philippians"] },
  { osisId: "Col", name: "Colossians", order: 51, aliases: ["col", "colossians"] },
  { osisId: "1Thess", name: "1 Thessalonians", order: 52, aliases: ["1thess", "1 thess", "1 thessalonians", "first thessalonians"] },
  { osisId: "2Thess", name: "2 Thessalonians", order: 53, aliases: ["2thess", "2 thess", "2 thessalonians", "second thessalonians"] },
  { osisId: "1Tim", name: "1 Timothy", order: 54, aliases: ["1tim", "1 tim", "1 timothy", "first timothy"] },
  { osisId: "2Tim", name: "2 Timothy", order: 55, aliases: ["2tim", "2 tim", "2 timothy", "second timothy"] },
  { osisId: "Titus", name: "Titus", order: 56, aliases: ["titus", "tit"] },
  { osisId: "Phlm", name: "Philemon", order: 57, aliases: ["phlm", "philemon", "philem"] },
  { osisId: "Heb", name: "Hebrews", order: 58, aliases: ["heb", "hebrews"] },
  { osisId: "Jas", name: "James", order: 59, aliases: ["jas", "james", "jam"] },
  { osisId: "1Pet", name: "1 Peter", order: 60, aliases: ["1pet", "1 pet", "1 peter", "first peter"] },
  { osisId: "2Pet", name: "2 Peter", order: 61, aliases: ["2pet", "2 pet", "2 peter", "second peter"] },
  { osisId: "1John", name: "1 John", order: 62, aliases: ["1john", "1 john", "first john"] },
  { osisId: "2John", name: "2 John", order: 63, aliases: ["2john", "2 john", "second john"] },
  { osisId: "3John", name: "3 John", order: 64, aliases: ["3john", "3 john", "third john"] },
  { osisId: "Jude", name: "Jude", order: 65, aliases: ["jude"] },
  { osisId: "Rev", name: "Revelation", order: 66, aliases: ["rev", "revelation", "apocalypse"] }
] as const;

export function normalizeBook(input?: string | null) {
  if (!input) return undefined;
  const value = input.trim().replace(/\s+/g, " ");
  const lower = value.toLowerCase();
  const byAlias = ntBooks.find(
    (book) => book.osisId.toLowerCase() === lower || book.aliases.some((alias) => alias === lower)
  );

  return byAlias?.osisId ?? value;
}

export function bookName(osisId: string) {
  return ntBooks.find((book) => book.osisId === osisId)?.name ?? osisId;
}

export function parseReference(
  input?: string | null
): { book: string; chapter: number; verse: number; verseEnd?: number } | null {
  if (!input) return null;
  const match = input.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const book = normalizeBook(match[1]);
  if (!book) return null;

  const chapter = Number.parseInt(match[2], 10);
  const verse = Number.parseInt(match[3], 10);
  const verseEnd = match[4] ? Number.parseInt(match[4], 10) : undefined;

  return { book, chapter, verse, ...(verseEnd !== undefined ? { verseEnd } : {}) };
}

export function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
