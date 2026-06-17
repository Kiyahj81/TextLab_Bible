import { describe, expect, it } from "vitest";
import { parseReaderMode, READER_MODE_COOKIE } from "@/lib/readerPrefs";

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
