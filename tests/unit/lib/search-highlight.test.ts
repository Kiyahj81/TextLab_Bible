import { describe, expect, it } from "vitest";
import { splitWithMatches } from "@/lib/search-highlight";

describe("splitWithMatches", () => {
  it("returns a single text segment when no match is provided", () => {
    expect(splitWithMatches("Hello world", "")).toEqual([{ kind: "text", value: "Hello world" }]);
  });

  it("returns empty array for empty text", () => {
    expect(splitWithMatches("", "love")).toEqual([]);
  });

  it("highlights case-insensitively and preserves surrounding text", () => {
    expect(splitWithMatches("God is Love and love", "love")).toEqual([
      { kind: "text", value: "God is " },
      { kind: "match", value: "Love" },
      { kind: "text", value: " and " },
      { kind: "match", value: "love" }
    ]);
  });

  it("escapes regex metacharacters in the needle", () => {
    expect(splitWithMatches("a.b a*b a+b", "a.b")).toEqual([
      { kind: "match", value: "a.b" },
      { kind: "text", value: " a*b a+b" }
    ]);
  });

  it("matches polytonic Greek surfaces", () => {
    const verse = "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν";
    const segments = splitWithMatches(verse, "λόγος");
    const matches = segments.filter((segment) => segment.kind === "match");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.value).toBe("λόγος");
  });
});
