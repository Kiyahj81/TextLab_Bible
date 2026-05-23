import { describe, expect, it } from "vitest";
import { parseNotesSort, parseReferenceFilter } from "@/lib/notes-filter";

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
