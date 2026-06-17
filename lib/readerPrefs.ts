export type ReaderMode = "greek" | "english" | "parallel";

export const READER_MODES: readonly ReaderMode[] = ["greek", "english", "parallel"];
export const READER_MODE_COOKIE = "textlab-reader-mode";
export const LAST_PASSAGE_COOKIE = "textlab-reader-last-passage";

export function introCookieName(id: string): string {
  return `textlab-intro-dismissed-${id}`;
}

export function parseReaderMode(value: string | null | undefined): ReaderMode | null {
  return value != null && (READER_MODES as readonly string[]).includes(value)
    ? (value as ReaderMode)
    : null;
}

export type SavedPassage = { book: string; chapter: number };

export function parseSavedPassage(value: string | null | undefined): SavedPassage | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SavedPassage>;
    if (typeof parsed?.book === "string" && Number.isInteger(parsed?.chapter)) {
      return { book: parsed.book, chapter: parsed.chapter as number };
    }
  } catch {
    // malformed cookie — ignore
  }
  return null;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Client-only writer for non-httpOnly preference cookies. Server reads via cookies().
export function writePrefCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
