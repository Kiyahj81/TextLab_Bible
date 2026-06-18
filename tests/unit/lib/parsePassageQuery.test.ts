// tests/unit/lib/parsePassageQuery.test.ts
import { describe, expect, it } from "vitest";
import { parsePassageQuery } from "@/lib/references";

describe("parsePassageQuery", () => {
  it("parses book + chapter", () => {
    expect(parsePassageQuery("John 3")).toEqual({ book: "John", chapter: 3 });
  });
  it("parses book + chapter:verse", () => {
    expect(parsePassageQuery("John 3:16")).toEqual({ book: "John", chapter: 3, verse: 16 });
  });
  it("resolves aliases and ranges (uses the start verse)", () => {
    expect(parsePassageQuery("1 cor 13:4-7")).toEqual({ book: "1Cor", chapter: 13, verse: 4 });
  });
  it("rejects unknown books and malformed input", () => {
    expect(parsePassageQuery("Hobbiton 1:1")).toBeNull();
    expect(parsePassageQuery("John")).toBeNull();
    expect(parsePassageQuery("")).toBeNull();
    expect(parsePassageQuery(null)).toBeNull();
  });
  it("rejects non-positive chapter and verse", () => {
    expect(parsePassageQuery("John 0:1")).toBeNull();
    expect(parsePassageQuery("John 3:0")).toBeNull();
  });
  it("rejects a non-positive range end", () => {
    expect(parsePassageQuery("John 3:16-0")).toBeNull();
  });
});
