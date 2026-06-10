import { describe, expect, it } from "vitest";
import { decodeMorphCode } from "@/lib/morphology";

describe("decodeMorphCode", () => {
  it("decodes nominals", () => {
    expect(decodeMorphCode("N-NSM")).toBe("noun — nominative singular masculine");
    expect(decodeMorphCode("RANSM")).toBe("article — nominative singular masculine");
    expect(decodeMorphCode("A-NSMC")).toBe("adjective — nominative singular masculine, comparative");
  });

  it("decodes verbs", () => {
    expect(decodeMorphCode("V-3PAI-S")).toBe("verb — present active indicative, 3rd person singular");
    expect(decodeMorphCode("V-PAPNSM")).toBe("verb — present active participle, nominative singular masculine");
    expect(decodeMorphCode("V-PAN")).toBe("verb — present active infinitive");
  });

  it("handles indeclinables whose trailing dash was stripped at import", () => {
    expect(decodeMorphCode("C")).toBe("conjunction");
    expect(decodeMorphCode("P")).toBe("preposition");
  });

  it("falls back to the part of speech for an unknown remainder", () => {
    expect(decodeMorphCode("N-XYZ")).toBe("noun");
  });

  it("returns null for unknown codes", () => {
    expect(decodeMorphCode("ZZTOP")).toBeNull();
    expect(decodeMorphCode("")).toBeNull();
  });

  it("decodes person-marked pronouns", () => {
    expect(decodeMorphCode("RP1NS")).toBe("personal pronoun — 1st person nominative singular");
    expect(decodeMorphCode("RP2AS")).toBe("personal pronoun — 2nd person accusative singular");
  });

  it("decodes gendered third-person pronouns via the nominal branch", () => {
    expect(decodeMorphCode("RPNSM")).toBe("personal pronoun — nominative singular masculine");
  });

  it("decodes adverb degree", () => {
    expect(decodeMorphCode("D-C")).toBe("adverb — comparative");
    expect(decodeMorphCode("D-S")).toBe("adverb — superlative");
  });

  it("decodes the seed-aligned demonstrative and finite-verb shapes", () => {
    expect(decodeMorphCode("RDNSM")).toBe("demonstrative pronoun — nominative singular masculine");
    expect(decodeMorphCode("V-3IAI-S")).toBe("verb — imperfect active indicative, 3rd person singular");
  });
});
