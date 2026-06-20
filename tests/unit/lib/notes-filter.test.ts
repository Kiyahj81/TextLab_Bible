import { describe, expect, it } from "vitest";
import { noteCanonicalKey, parseNotesSort, parseReferenceFilter } from "@/lib/notes-filter";

describe("parseNotesSort", () => {
  it("defaults to 'recent' for unknown / empty input", () => {
    expect(parseNotesSort(undefined)).toBe("recent");
    expect(parseNotesSort(null)).toBe("recent");
    expect(parseNotesSort("")).toBe("recent");
    expect(parseNotesSort("nonsense")).toBe("recent");
  });

  it("returns supported sort values verbatim", () => {
    expect(parseNotesSort("canonical")).toBe("canonical");
    expect(parseNotesSort("title")).toBe("title");
    expect(parseNotesSort("recent")).toBe("recent");
  });
});

describe("parseReferenceFilter", () => {
  it("returns null for empty input", () => {
    expect(parseReferenceFilter("")).toBeNull();
    expect(parseReferenceFilter("   ")).toBeNull();
  });

  it("parses a single-token book name to its OSIS id", () => {
    expect(parseReferenceFilter("John")).toEqual({ book: "John", chapter: undefined });
  });

  it("normalizes lowercase aliases to OSIS ids", () => {
    expect(parseReferenceFilter("jn")).toEqual({ book: "John", chapter: undefined });
  });

  it("parses 'Book N' as book + chapter", () => {
    expect(parseReferenceFilter("John 1")).toEqual({ book: "John", chapter: 1 });
  });

  it("parses multi-token book names with a trailing chapter", () => {
    expect(parseReferenceFilter("1 Cor 4")).toEqual({ book: "1Cor", chapter: 4 });
  });

  it("falls through to the raw token when the book is unknown (substring fallback)", () => {
    expect(parseReferenceFilter("Jo")).toEqual({ book: "Jo", chapter: undefined });
  });
});

describe("noteCanonicalKey", () => {
  it("derives the key from a verse-attached note", () => {
    expect(noteCanonicalKey({ book: { order: 43 }, chapter: 1, verse: 1 }, null)).toEqual({
      refBookOrder: 43,
      refChapter: 1,
      refVerse: 1
    });
  });

  it("derives the key from a token-attached note", () => {
    expect(noteCanonicalKey(null, { book: { order: 43 }, chapter: 2, verse: 16 })).toEqual({
      refBookOrder: 43,
      refChapter: 2,
      refVerse: 16
    });
  });

  it("prefers the verse when both relations are present", () => {
    expect(
      noteCanonicalKey({ book: { order: 43 }, chapter: 1, verse: 1 }, { book: { order: 99 }, chapter: 9, verse: 9 })
    ).toEqual({ refBookOrder: 43, refChapter: 1, refVerse: 1 });
  });

  it("returns nulls when neither relation is present", () => {
    expect(noteCanonicalKey(null, null)).toEqual({
      refBookOrder: null,
      refChapter: null,
      refVerse: null
    });
  });
});
