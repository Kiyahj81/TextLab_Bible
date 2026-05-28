import { describe, expect, it } from "vitest";
import {
  detectGreekWords,
  detectIntent,
  detectMorphCodes,
  detectReferences,
  detectTopicWords,
  extractSignals
} from "@/lib/ai/signals";

describe("detectReferences", () => {
  it("parses a bare book + chapter", () => {
    expect(detectReferences("Romans 7")).toEqual([{ book: "Rom", chapter: 7 }]);
  });

  it("parses a single verse", () => {
    expect(detectReferences("Rom 7:1")).toEqual([{ book: "Rom", chapter: 7, verseStart: 1 }]);
  });

  it("parses a verse range with a hyphen", () => {
    expect(detectReferences("Rom 7:1-6")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 1, verseEnd: 6 }
    ]);
  });

  it("parses a verse range with an en-dash", () => {
    expect(detectReferences("Rom 7:1–6")).toEqual([
      { book: "Rom", chapter: 7, verseStart: 1, verseEnd: 6 }
    ]);
  });

  it("parses a numbered book", () => {
    expect(detectReferences("1 Cor 13")).toEqual([{ book: "1Cor", chapter: 13 }]);
  });

  it("parses John 3:16", () => {
    expect(detectReferences("John 3:16")).toEqual([{ book: "John", chapter: 3, verseStart: 16 }]);
  });

  it("parses multiple references in one prompt", () => {
    expect(detectReferences("In Romans 7 and 1 Cor 13")).toEqual([
      { book: "Rom", chapter: 7 },
      { book: "1Cor", chapter: 13 }
    ]);
  });

  it("does not match book aliases embedded in other words", () => {
    expect(detectReferences("romance languages")).toEqual([]);
    expect(detectReferences("from the start")).toEqual([]);
  });
});

describe("detectGreekWords", () => {
  it("extracts a single Greek word", () => {
    expect(detectGreekWords("What does νόμος mean?")).toEqual(["νόμος"]);
  });

  it("extracts multiple Greek words", () => {
    expect(detectGreekWords("compare λόγος and σάρξ")).toEqual([
      "λόγος",
      "σάρξ"
    ]);
  });

  it("drops single-character Greek runs", () => {
    expect(detectGreekWords("the word ὁ")).toEqual([]);
  });

  it("deduplicates repeated Greek words", () => {
    expect(detectGreekWords("νόμος and νόμος")).toEqual(["νόμος"]);
  });
});

describe("detectMorphCodes", () => {
  it("treats a full code as exact", () => {
    expect(detectMorphCodes("find V-PAI-3S forms")).toEqual([{ code: "V-PAI-3S", mode: "exact" }]);
  });

  it("treats a complete nominal parse as exact", () => {
    expect(detectMorphCodes("show N-NSM forms")).toEqual([{ code: "N-NSM", mode: "exact" }]);
  });

  it("treats a short partial code as a prefix", () => {
    expect(detectMorphCodes("V-P verbs")).toEqual([{ code: "V-P", mode: "prefix" }]);
  });

  it("returns nothing when there are no codes", () => {
    expect(detectMorphCodes("no codes here")).toEqual([]);
  });

  it("does not treat hyphenated words like COVID-19 as morph codes", () => {
    expect(detectMorphCodes("the COVID-19 pandemic")).toEqual([]);
  });
});

describe("detectTopicWords", () => {
  it("keeps content words and drops stopwords and book names", () => {
    expect(detectTopicWords("What is the role of law in Romans?")).toEqual(["law"]);
  });

  it("drops proper nouns and common verbs", () => {
    expect(detectTopicWords("How does Paul use πίστις?")).toEqual([]);
  });
});

describe("detectIntent", () => {
  it("classifies a meaning question as word-study", () => {
    expect(detectIntent("What does νόμος mean?")).toBe("word-study");
  });

  it("classifies a show/read request as passage-study", () => {
    expect(detectIntent("Show me Romans 7")).toBe("passage-study");
  });

  it("classifies a verses-about request as topic-survey", () => {
    expect(detectIntent("Find verses about love")).toBe("topic-survey");
  });

  it("classifies a grammar request as morphology", () => {
    expect(detectIntent("imperatives in 1 Peter")).toBe("morphology");
  });

  it("classifies a difference request as comparison", () => {
    expect(detectIntent("difference between νόμος and χάρις")).toBe("comparison");
  });

  it("falls back to general", () => {
    expect(detectIntent("Tell me about God")).toBe("general");
  });
});

describe("extractSignals", () => {
  it("composes all detectors for a word study with a reference", () => {
    const signals = extractSignals("What does νόμος mean in Romans 7?");
    expect(signals).toEqual({
      references: [{ book: "Rom", chapter: 7 }],
      greekWords: ["νόμος"],
      topicWords: [],
      morphCodes: [],
      intent: "word-study",
      book: "Rom"
    });
  });
});
