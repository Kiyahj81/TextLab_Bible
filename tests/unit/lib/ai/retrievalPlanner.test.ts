import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Signals } from "@/lib/ai/signals";

const { getPassage, searchLemma, searchKeyword, searchMorphology, getTopLemmas, findLemmaExamples } =
  vi.hoisted(() => ({
    getPassage: vi.fn(),
    searchLemma: vi.fn(),
    searchKeyword: vi.fn(),
    searchMorphology: vi.fn(),
    getTopLemmas: vi.fn(),
    findLemmaExamples: vi.fn()
  }));

vi.mock("@/lib/search", () => ({
  getPassage,
  searchLemma,
  searchKeyword,
  searchMorphology,
  getTopLemmas,
  findLemmaExamples
}));

import { runRetrievalPlan } from "@/lib/ai/retrievalPlanner";

const emptySignals: Signals = {
  references: [],
  greekWords: [],
  topicWords: [],
  morphCodes: [],
  intent: "general"
};

beforeEach(() => {
  vi.clearAllMocks();
  getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
    corpus: input.corpus,
    references: [
      {
        book: input.book,
        chapter: input.chapter,
        verse: 1,
        reference: `${input.book} ${input.chapter}:1`,
        text: `${input.corpus} text`
      }
    ]
  }));
  searchLemma.mockImplementation(async (input: { lemma: string }) => ({
    lemma: input.lemma,
    count: 1,
    results: [
      {
        tokenId: `tok-${input.lemma}`,
        corpus: "SBLGNT",
        reference: "Rom 7:1",
        surface: input.lemma,
        lemma: input.lemma,
        morphCode: "N-NSM",
        verseText: "verse text"
      }
    ],
    pagination: {}
  }));
  searchKeyword.mockImplementation(async (input: { query: string }) => ({
    query: input.query,
    results: [{ corpus: "WEB", reference: "Rom 1:1", text: `match for ${input.query}` }],
    pagination: {}
  }));
  searchMorphology.mockImplementation(async (input: { morphCode: string }) => ({
    morphCode: input.morphCode,
    count: 1,
    results: [
      {
        tokenId: "tok-morph",
        corpus: "SBLGNT",
        reference: "1Pet 1:1",
        surface: "form",
        lemma: "lemma",
        morphCode: input.morphCode,
        verseText: "verse text"
      }
    ],
    pagination: {}
  }));
  getTopLemmas.mockResolvedValue([{ lemma: "λόγος", partOfSpeech: "N-", count: 10 }]);
  findLemmaExamples.mockResolvedValue(
    new Map([
      [
        "λόγος",
        [
          {
            tokenId: "ex-1",
            corpus: "SBLGNT",
            reference: "John 1:1",
            surface: "λόγος",
            lemma: "λόγος",
            morphCode: "N-NSM",
            verseText: "Ἐν ἀρχῇ"
          }
        ]
      ]
    ])
  );
});

describe("runRetrievalPlan", () => {
  it("fetches both corpora for a reference and searches detected Greek words", async () => {
    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "Rom", chapter: 7 }],
      greekWords: ["νόμος"],
      intent: "word-study",
      book: "Rom"
    });

    expect(getPassage).toHaveBeenCalledTimes(2);
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "SBLGNT", book: "Rom", chapter: 7 }));
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "WEB", book: "Rom", chapter: 7 }));
    expect(searchLemma).toHaveBeenCalledTimes(1);
    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: "νόμος", book: "Rom" }));

    expect(packet.citations.length).toBeGreaterThan(0);
    expect(packet.citations.some((c) => c.toolName === "searchLemma")).toBe(true);
    expect(packet.citations.some((c) => c.toolName === "getPassage")).toBe(true);
    expect(packet.toolTrace.some((t) => t.tool === "searchLemma")).toBe(true);
    expect(packet.formattedEvidence).toContain("νόμος");
  });

  it("deduplicates a Greek word and a topic word that map to the same lemma", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      greekWords: ["νόμος"],
      topicWords: ["law"], // law → νόμος
      intent: "word-study"
    });

    expect(searchLemma).toHaveBeenCalledTimes(1);
    expect(searchKeyword).not.toHaveBeenCalled();
  });

  it("uses keyword search for a topic word with no Greek mapping", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      topicWords: ["donkey"],
      intent: "topic-survey"
    });

    expect(searchKeyword).toHaveBeenCalledTimes(1);
    expect(searchKeyword).toHaveBeenCalledWith(expect.objectContaining({ query: "donkey" }));
  });

  it("isolates a failing tool call and keeps the rest", async () => {
    searchLemma.mockRejectedValueOnce(new Error("db down"));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "Rom", chapter: 7 }],
      greekWords: ["νόμος"],
      intent: "word-study"
    });

    expect(packet.toolTrace.some((t) => t.tool === "searchLemma" && t.error)).toBe(true);
    expect(packet.citations.some((c) => c.toolName === "getPassage")).toBe(true);
  });

  it("caps the number of planned calls", async () => {
    const greekWords = Array.from({ length: 12 }, (_, i) => `λ${i}`);

    await runRetrievalPlan({ ...emptySignals, greekWords, intent: "word-study" });

    expect(searchLemma.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("falls back to top lemmas for a bare topic survey scoped to a book", async () => {
    await runRetrievalPlan({ ...emptySignals, intent: "topic-survey", book: "Heb" });

    expect(getTopLemmas).toHaveBeenCalledWith(expect.objectContaining({ book: "Heb" }));
    expect(findLemmaExamples).toHaveBeenCalled();
  });

  it("caps citations per call and overall so consumers' limits are respected", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 60 }, (_, i) => ({
        book: input.book,
        chapter: input.chapter,
        verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`,
        text: "t"
      }))
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "John", chapter: 1 }],
      intent: "passage-study"
    });

    // Each getPassage call contributes a bounded sample, not all 60 verses.
    expect(packet.citations.filter((c) => c.corpus === "SBLGNT").length).toBeLessThanOrEqual(10);
    expect(packet.citations.length).toBeLessThanOrEqual(40);
    // The first verse is still cited.
    expect(packet.citations.some((c) => c.reference === "John 1:1")).toBe(true);
  });

  it("produces an empty-evidence packet when there are no signals", async () => {
    const packet = await runRetrievalPlan(emptySignals);

    expect(packet.citations).toEqual([]);
    expect(getPassage).not.toHaveBeenCalled();
    expect(searchLemma).not.toHaveBeenCalled();
  });
});
