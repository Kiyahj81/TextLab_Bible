import { describe, expect, it } from "vitest";
import { parseHeadlineSegments, splitWithMatches, HEADLINE_OPTIONS } from "@/lib/search-highlight";

const S = String.fromCharCode(0xe000); // StartSel (U+E000)
const E = String.fromCharCode(0xe001); // StopSel  (U+E001)

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

describe("parseHeadlineSegments", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseHeadlineSegments("")).toEqual([]);
  });

  it("returns a single text segment when there are no sentinels", () => {
    expect(parseHeadlineSegments("In the beginning")).toEqual([
      { kind: "text", value: "In the beginning" }
    ]);
  });

  it("splits a marked word into text/match/text", () => {
    expect(parseHeadlineSegments(`God so ${S}loved${E} the world`)).toEqual([
      { kind: "text", value: "God so " },
      { kind: "match", value: "loved" },
      { kind: "text", value: " the world" }
    ]);
  });

  it("handles a leading match with no preceding text", () => {
    expect(parseHeadlineSegments(`${S}Love${E} is patient`)).toEqual([
      { kind: "match", value: "Love" },
      { kind: "text", value: " is patient" }
    ]);
  });

  it("handles adjacent matches", () => {
    expect(parseHeadlineSegments(`${S}a${E}${S}b${E}`)).toEqual([
      { kind: "match", value: "a" },
      { kind: "match", value: "b" }
    ]);
  });

  it("exposes ts_headline options using the same sentinels it parses", () => {
    expect(HEADLINE_OPTIONS).toContain("HighlightAll");
    expect(HEADLINE_OPTIONS).toContain(S);
    expect(HEADLINE_OPTIONS).toContain(E);
  });
});
