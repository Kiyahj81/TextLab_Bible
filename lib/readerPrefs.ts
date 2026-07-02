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
    // Reject empty book / non-positive / non-integer chapter: this value builds
    // a bare-/read redirect URL, so a tampered cookie must not yield an invalid passage.
    if (
      typeof parsed?.book === "string" &&
      parsed.book.trim().length > 0 &&
      Number.isInteger(parsed?.chapter) &&
      (parsed.chapter as number) >= 1
    ) {
      return { book: parsed.book.trim(), chapter: parsed.chapter as number };
    }
  } catch {
    // malformed cookie — ignore
  }
  return null;
}

export type ReaderLayout = "study" | "continuous";
export const READER_LAYOUTS: readonly ReaderLayout[] = ["study", "continuous"];
export const READER_LAYOUT_COOKIE = "textlab-reader-layout";

export function parseReaderLayout(value: string | null | undefined): ReaderLayout | null {
  return value != null && (READER_LAYOUTS as readonly string[]).includes(value)
    ? (value as ReaderLayout)
    : null;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Client-only writer for non-httpOnly preference cookies. Server reads via cookies().
export function writePrefCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

export const ASSISTANT_AUTO_SCHOLARLY_COOKIE = "textlab-assistant-auto-scholarly";

export function parseAutoScholarly(value: string | null | undefined): boolean {
  return value === "1";
}

export const ASSISTANT_CONFIRM_SCHOLARLY_COOKIE = "textlab-assistant-confirm-scholarly";

export function parseConfirmScholarly(value: string | null | undefined): boolean {
  return value === "1";
}

// Migration: the legacy auto-scholarly cookie wrote "1" (auto ON) and "0"
// (explicit opt-out). New confirm cookie wins when present; a legacy "0" is a
// deliberate opt-out of auto-scholarly and maps to confirm-first; "1" or absence
// takes the new automatic default.
export function resolveConfirmScholarly(
  confirmCookie: string | undefined,
  legacyAutoCookie: string | undefined
): boolean {
  if (confirmCookie !== undefined) return parseConfirmScholarly(confirmCookie);
  return legacyAutoCookie === "0";
}
