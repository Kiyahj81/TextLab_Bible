import { describe, expect, it } from "vitest";
import { parseNotesSort, parseReferenceFilter, sortNotesCanonically } from "@/lib/notes-filter";

type TestNote = {
  id: string;
  updatedAt: Date;
  verse: { book: { order: number }; chapter: number; verse: number } | null;
  token: { book: { order: number }; chapter: number; verse: number } | null;
};

function verseNote(id: string, order: number, chapter: number, verse: number, updatedAt = "2026-01-01"): TestNote {
  return { id, updatedAt: new Date(updatedAt), verse: { book: { order }, chapter, verse }, token: null };
}

function tokenNote(id: string, order: number, chapter: number, verse: number, updatedAt = "2026-01-01"): TestNote {
  return { id, updatedAt: new Date(updatedAt), verse: null, token: { book: { order }, chapter, verse } };
}

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

describe("sortNotesCanonically", () => {
  it("orders token-attached notes by their own reference, not by recency", () => {
    // John 1:2 was edited more recently than John 1:1, but canonical order must
    // still place 1:1 first. (Bug #1: token notes fell back to updatedAt desc.)
    const notes = [
      tokenNote("john-1-2", 43, 1, 2, "2026-06-10"),
      tokenNote("john-1-1", 43, 1, 1, "2026-01-01")
    ];
    expect(sortNotesCanonically(notes).map((n) => n.id)).toEqual(["john-1-1", "john-1-2"]);
  });

  it("interleaves token- and verse-attached notes by effective reference", () => {
    // John (book 43) token notes must precede Rom (45) / 1Cor (46) verse notes.
    // (Bug #2: token notes collapsed to the end, looking like a tag-first sort.)
    const notes = [
      verseNote("rom-1-18", 45, 1, 18),
      verseNote("1cor-15-17", 46, 15, 17),
      tokenNote("john-1-1", 43, 1, 1),
      tokenNote("john-2-16", 43, 2, 16),
      tokenNote("john-1-2", 43, 1, 2)
    ];
    expect(sortNotesCanonically(notes).map((n) => n.id)).toEqual([
      "john-1-1",
      "john-1-2",
      "john-2-16",
      "rom-1-18",
      "1cor-15-17"
    ]);
  });

  it("breaks ties on the same reference by most-recently updated", () => {
    const notes = [
      tokenNote("older", 43, 1, 1, "2026-01-01"),
      verseNote("newer", 43, 1, 1, "2026-06-10")
    ];
    expect(sortNotesCanonically(notes).map((n) => n.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate the input array", () => {
    const notes = [tokenNote("b", 43, 1, 2), tokenNote("a", 43, 1, 1)];
    const before = notes.map((n) => n.id);
    sortNotesCanonically(notes);
    expect(notes.map((n) => n.id)).toEqual(before);
  });
});
