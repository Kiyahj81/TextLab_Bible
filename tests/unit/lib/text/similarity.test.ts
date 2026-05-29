import { describe, expect, it } from "vitest";
import {
  levenshtein,
  normalizeGreek,
  normalizeEnglish,
  containmentScore
} from "@/lib/text/similarity";

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
});

describe("normalizeGreek", () => {
  it("folds diacritics, lowercases, and normalizes final sigma", () => {
    expect(normalizeGreek("Ἐν ἀρχῇ")).toBe("εν αρχη");
    expect(normalizeGreek("λόγος")).toBe("λογοσ");
  });

  it("strips punctuation", () => {
    expect(normalizeGreek("θεός·")).toBe("θεοσ");
  });
});

describe("normalizeEnglish", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeEnglish("The  Word, became flesh.")).toBe("the word became flesh");
  });
});

describe("containmentScore", () => {
  it("scores an exact substring as 1", () => {
    expect(containmentScore("εν αρχη", "εν αρχη ην ο λογοσ")).toBe(1);
  });

  it("scores a near-miss fragment via best window", () => {
    expect(containmentScore("εν αρχn", "εν αρχη ην ο λογοσ")).toBeGreaterThanOrEqual(0.85);
  });

  it("scores unrelated text low", () => {
    expect(containmentScore("ουρανοσ", "εν αρχη ην ο λογοσ")).toBeLessThan(0.5);
  });

  it("returns 0 for an empty quote", () => {
    expect(containmentScore("", "anything")).toBe(0);
  });
});
