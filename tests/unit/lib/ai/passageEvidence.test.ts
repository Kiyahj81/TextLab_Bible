// tests/unit/lib/ai/passageEvidence.test.ts
import { describe, expect, it } from "vitest";
import { formatTokenAnnotations } from "@/lib/ai/passageEvidence";
import type { PassageToken } from "@/lib/search/passageTokens";

const tok = (over: Partial<PassageToken>): PassageToken => ({
  surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM",
  partOfSpeech: "N-", gloss: "word", domainLabel: "Communication (33)", ...over
});

describe("formatTokenAnnotations", () => {
  it("renders surface · lemma · decoded morph · gloss · domain", () => {
    const [line] = formatTokenAnnotations([tok({})]);
    expect(line).toBe('    λόγος · λόγος · noun — nominative singular masculine · "word" · Communication (33)');
  });

  it("omits absent fields rather than placeholdering them", () => {
    const [line] = formatTokenAnnotations([tok({ gloss: null, domainLabel: null, morphCode: null })]);
    expect(line).toBe("    λόγος · λόγος");
  });

  it("skips article/conjunction/particle when contentOnly", () => {
    const lines = formatTokenAnnotations(
      [tok({ surface: "ὁ", lemma: "ὁ", partOfSpeech: "RA" }), tok({})],
      { contentOnly: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("λόγος");
  });

  it("keeps a stoplist token when it is a query target lemma", () => {
    const lines = formatTokenAnnotations(
      [tok({ surface: "καί", lemma: "καί", partOfSpeech: "C-" })],
      { contentOnly: true, targetLemmas: new Set(["καί"]) }
    );
    expect(lines).toHaveLength(1);
  });

  it("keeps function words when contentOnly is false (morphology intent)", () => {
    const lines = formatTokenAnnotations([tok({ partOfSpeech: "C-" })], { contentOnly: false });
    expect(lines).toHaveLength(1);
  });
});
