import { describe, expect, it } from "vitest";
import { parseReference, readerHref } from "@/lib/references";

describe("parseReference", () => {
  it("parses a simple reference", () => {
    expect(parseReference("John 1:14")).toEqual({ book: "John", chapter: 1, verse: 14 });
  });

  it("parses a numbered book name", () => {
    expect(parseReference("1 John 2:23")).toEqual({ book: "1John", chapter: 2, verse: 23 });
  });

  it("parses a verse range", () => {
    expect(parseReference("Rom 8:1-4")).toEqual({ book: "Rom", chapter: 8, verse: 1, verseEnd: 4 });
  });

  it("normalizes book aliases", () => {
    expect(parseReference("matthew 5:9")).toEqual({ book: "Matt", chapter: 5, verse: 9 });
  });

  it("returns null for prose with no chapter:verse", () => {
    expect(parseReference("the prologue")).toBeNull();
    expect(parseReference("")).toBeNull();
  });
});

describe("readerHref", () => {
  it("builds a reader URL from a formatted reference", () => {
    expect(readerHref("John 1:14")).toBe("/read?book=John&chapter=1&verse=14");
  });

  it("handles numbered books", () => {
    expect(readerHref("1Cor 13:13")).toBe("/read?book=1Cor&chapter=13&verse=13");
  });

  it("returns null for unparseable references", () => {
    expect(readerHref("not a reference")).toBeNull();
  });

  it("links a verse range to the first verse", () => {
    expect(readerHref("Rom 8:1-4")).toBe("/read?book=Rom&chapter=8&verse=1");
  });
});
