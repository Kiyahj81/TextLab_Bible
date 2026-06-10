import { describe, expect, it } from "vitest";
import { querySearchLabel, scopeSuffix } from "@/lib/searchLabel";

describe("scopeSuffix", () => {
  it("is empty without a book", () => {
    expect(scopeSuffix("")).toBe("");
  });

  it("names the book and optional chapter", () => {
    expect(scopeSuffix("1Cor")).toBe(" in 1 Corinthians");
    expect(scopeSuffix("John", 1)).toBe(" in John 1");
  });
});

describe("querySearchLabel", () => {
  it("includes the mode, query, and scope", () => {
    expect(querySearchLabel("lemma", "λόγος", "John")).toBe('lemma "λόγος" in John');
    expect(querySearchLabel("keyword", "light", "")).toBe('keyword "light"');
  });
});
