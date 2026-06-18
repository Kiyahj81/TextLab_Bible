import { describe, expect, it } from "vitest";
import { parseReaderMode, parseSavedPassage, READER_MODE_COOKIE } from "@/lib/readerPrefs";

describe("parseReaderMode", () => {
  it("accepts the three valid modes", () => {
    expect(parseReaderMode("greek")).toBe("greek");
    expect(parseReaderMode("english")).toBe("english");
    expect(parseReaderMode("parallel")).toBe("parallel");
  });
  it("falls back to null for anything else", () => {
    expect(parseReaderMode("klingon")).toBeNull();
    expect(parseReaderMode(null)).toBeNull();
    expect(parseReaderMode(undefined)).toBeNull();
  });
  it("exposes a stable cookie name", () => {
    expect(READER_MODE_COOKIE).toBe("textlab-reader-mode");
  });
});

describe("parseSavedPassage", () => {
  it("parses a valid saved passage", () => {
    expect(parseSavedPassage('{"book":"John","chapter":3}')).toEqual({ book: "John", chapter: 3 });
  });
  it("rejects empty, missing, or malformed input", () => {
    expect(parseSavedPassage(null)).toBeNull();
    expect(parseSavedPassage(undefined)).toBeNull();
    expect(parseSavedPassage("")).toBeNull();
    expect(parseSavedPassage("not json")).toBeNull();
    expect(parseSavedPassage("{}")).toBeNull();
  });
  it("rejects an empty or whitespace-only book (would build an invalid /read redirect)", () => {
    expect(parseSavedPassage('{"book":"","chapter":3}')).toBeNull();
    expect(parseSavedPassage('{"book":"   ","chapter":3}')).toBeNull();
  });
  it("trims surrounding whitespace from an otherwise-valid book", () => {
    expect(parseSavedPassage('{"book":" John ","chapter":3}')).toEqual({ book: "John", chapter: 3 });
  });
  it("rejects a non-positive or non-integer chapter", () => {
    expect(parseSavedPassage('{"book":"John","chapter":0}')).toBeNull();
    expect(parseSavedPassage('{"book":"John","chapter":-1}')).toBeNull();
    expect(parseSavedPassage('{"book":"John","chapter":3.5}')).toBeNull();
  });
});

import { parseReaderLayout, READER_LAYOUT_COOKIE } from "@/lib/readerPrefs";

describe("parseReaderLayout", () => {
  it("accepts study and continuous, rejects others", () => {
    expect(parseReaderLayout("study")).toBe("study");
    expect(parseReaderLayout("continuous")).toBe("continuous");
    expect(parseReaderLayout("scroll")).toBeNull();
    expect(parseReaderLayout(null)).toBeNull();
  });
  it("exposes a stable cookie name", () => {
    expect(READER_LAYOUT_COOKIE).toBe("textlab-reader-layout");
  });
});
