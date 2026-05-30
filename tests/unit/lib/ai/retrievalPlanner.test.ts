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

    // Evidence lines may include the full passage, but citations stay capped per call.
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

  it("scopes a word search to a single named chapter", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "John", chapter: 1 }],
      greekWords: ["λόγος"],
      intent: "word-study",
      book: "John"
    });

    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: "λόγος", book: "John", chapter: 1 }));
  });

  it("does not chapter-scope a word search when only a book is named", async () => {
    await runRetrievalPlan({ ...emptySignals, greekWords: ["λόγος"], intent: "word-study", book: "John" });

    expect(searchLemma.mock.calls[0][0].chapter).toBeUndefined();
  });

  it("does not chapter-scope across a cross-chapter reference", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }],
      greekWords: ["λόγος"],
      intent: "word-study",
      book: "2Cor"
    });

    expect(searchLemma.mock.calls[0][0].chapter).toBeUndefined();
    expect(searchLemma.mock.calls[0][0].book).toBe("2Cor");
  });

  it("returns all word hits when the count is at or below the sample size", async () => {
    searchLemma.mockResolvedValueOnce({
      lemma: "λόγος",
      count: 2,
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ" },
        { tokenId: "t2", corpus: "SBLGNT", reference: "John 1:14", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "ὁ λόγος σὰρξ" }
      ],
      pagination: {}
    });

    const packet = await runRetrievalPlan({
      ...emptySignals, references: [{ book: "John", chapter: 1 }], greekWords: ["λόγος"], intent: "word-study", book: "John"
    });

    expect(packet.formattedEvidence).toContain("John 1:1");
    expect(packet.formattedEvidence).toContain("John 1:14");
    expect(packet.formattedEvidence).not.toContain("more)");
  });

  it("samples a large word search to 25 lines and shows the true total", async () => {
    const results = Array.from({ length: 25 }, (_, i) => ({
      tokenId: `t${i}`, corpus: "SBLGNT", reference: `John ${i + 1}:1`, surface: "ἀγάπη", lemma: "ἀγάπη", morphCode: "N-NSF", verseText: "x"
    }));
    searchLemma.mockResolvedValueOnce({ lemma: "ἀγάπη", count: 116, results, pagination: {} });

    const packet = await runRetrievalPlan({ ...emptySignals, greekWords: ["ἀγάπη"], intent: "word-study" });

    expect(packet.formattedEvidence).toContain("116 hit(s)");
    expect(packet.formattedEvidence).toContain("…(91 more)");
    // 25 table rows present (one per result)
    expect((packet.formattedEvidence.match(/\| John /g) ?? []).length).toBe(25);
  });

  it("requests a page size of at least 25 for word searches", async () => {
    await runRetrievalPlan({ ...emptySignals, greekWords: ["λόγος"], intent: "word-study" });
    expect(searchLemma.mock.calls[0][0].pageSize).toBeGreaterThanOrEqual(25);
  });

  it("returns the full chapter for a passage, not a 10-verse slice", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 51 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: `v${i + 1}`
      }))
    }));

    const packet = await runRetrievalPlan({ ...emptySignals, references: [{ book: "John", chapter: 1 }], intent: "passage-study" });

    expect(packet.formattedEvidence).toContain("John 1:14");
    expect(packet.formattedEvidence).toContain("John 1:51");
  });

  it("assembles a cross-chapter passage from per-chapter fetches", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number; verseStart: number }) => ({
      corpus: input.corpus,
      references: [{
        book: input.book, chapter: input.chapter, verse: input.verseStart,
        reference: `${input.book} ${input.chapter}:${input.verseStart}`, text: "t"
      }]
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "2Cor", chapter: 4, verseStart: 16, chapterEnd: 5, verseEnd: 10 }],
      intent: "passage-study"
    });

    // Both chapters fetched (per corpus): 4:16 and 5:1
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "SBLGNT", book: "2Cor", chapter: 4, verseStart: 16 }));
    expect(getPassage).toHaveBeenCalledWith(expect.objectContaining({ corpus: "SBLGNT", book: "2Cor", chapter: 5, verseStart: 1 }));
    expect(packet.formattedEvidence).toContain("2Cor 4:16");
    expect(packet.formattedEvidence).toContain("2Cor 5:1");
  });

  it("caps a pathological passage at the line ceiling with a more-marker", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 200 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: "t"
      }))
    }));

    const packet = await runRetrievalPlan({ ...emptySignals, references: [{ book: "Ps", chapter: 119 }], intent: "passage-study" });

    expect(packet.formattedEvidence).toContain("more)");
  });

  it("bounds a pathological cross-chapter span instead of expanding every chapter", async () => {
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 70 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: "t"
      }))
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      // An unvalidated end chapter from a user prompt ("John 1:1-999999999:1").
      references: [{ book: "John", chapter: 1, verseStart: 1, chapterEnd: 999_999_999, verseEnd: 1 }],
      intent: "passage-study"
    });

    // Must NOT fan out into ~1e9 segments/fetches: the span is clamped and the
    // fetch loop breaks once the line ceiling is reached (≤2 fetches per corpus).
    expect(getPassage.mock.calls.length).toBeLessThanOrEqual(8);
    expect(packet.formattedEvidence).toContain("more)");
    // No phantom traces: the tool trace lists only chapters actually fetched, so
    // the synthesis model is never told about chapters absent from the evidence.
    const passageTraces = packet.toolTrace.filter((t) => t.tool === "getPassage");
    expect(passageTraces.length).toBe(getPassage.mock.calls.length);
  });

  it("labels a same-chapter verse-range passage with the range, not just the chapter", async () => {
    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "Rom", chapter: 8, verseStart: 1, verseEnd: 4 }],
      intent: "passage-study"
    });

    expect(packet.formattedEvidence).toContain("getPassage(Rom 8:1-4");
  });
});
