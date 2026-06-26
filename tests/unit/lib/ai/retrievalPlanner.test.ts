import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ENGLISH_PHRASE_TO_GREEK_LEMMA,
  ENGLISH_TO_GREEK_LEMMA,
  extractSignals,
  type Signals
} from "@/lib/ai/signals";

const { getPassage, searchLemma, searchKeyword, searchMorphology, getTopLemmas, findLemmaExamples, searchSemanticDetailed, searchDomain, getPassageTokens } =
  vi.hoisted(() => ({
    getPassage: vi.fn(),
    searchLemma: vi.fn(),
    searchKeyword: vi.fn(),
    searchMorphology: vi.fn(),
    getTopLemmas: vi.fn(),
    findLemmaExamples: vi.fn(),
    searchSemanticDetailed: vi.fn(),
    searchDomain: vi.fn(),
    getPassageTokens: vi.fn()
  }));

vi.mock("@/lib/search", () => ({
  getPassage,
  searchLemma,
  searchKeyword,
  searchMorphology,
  getTopLemmas,
  findLemmaExamples,
  searchSemanticDetailed,
  searchDomain,
  getPassageTokens,
  SEMANTIC_INDEX_CORPUS: "WEB"
}));

import { runRetrievalPlan, shouldRunSemantic } from "@/lib/ai/retrievalPlanner";

const emptySignals: Signals = {
  references: [],
  greekWords: [],
  topicWords: [],
  morphCodes: [],
  intent: "general"
};

function semanticResult(
  results: Array<{ reference: string; corpus: string; text: string }>,
  status: "applied" | "fallback" | "disabled" = "fallback"
) {
  return { results, rerank: { status, candidateCount: results.length } };
}

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
  searchSemanticDetailed.mockResolvedValue(semanticResult([]));
  getPassageTokens.mockReset();
  getPassageTokens.mockResolvedValue([]);
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runRetrievalPlan", () => {
  it("requests rank ordering for keyword evidence so truncation keeps the strongest verses", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      topicWords: ["donkey"],
      intent: "word-study"
    });

    expect(searchKeyword).toHaveBeenCalledWith(expect.objectContaining({ orderBy: "rank" }));
  });

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

  it("maps satan and devil to their Greek lemmas instead of keyword search", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      topicWords: ["satan", "devil"],
      intent: "general"
    });

    expect(searchKeyword).not.toHaveBeenCalled();
    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: "Σατανᾶς" }));
    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: "διάβολος" }));
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

  it("book-scopes term searches for multiple references in the same book", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [
        { book: "John", chapter: 3 },
        { book: "John", chapter: 15 }
      ],
      topicWords: ["donkey"],
      intent: "comparison",
      book: "John"
    });

    expect(searchKeyword.mock.calls[0][0]).toEqual(expect.objectContaining({ query: "donkey", book: "John" }));
    expect(searchKeyword.mock.calls[0][0].chapter).toBeUndefined();
  });

  it("does not silently scope term searches to the first book for multi-book prompts", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      references: [
        { book: "Rom", chapter: 5 },
        { book: "1Cor", chapter: 13 }
      ],
      topicWords: ["donkey"],
      intent: "comparison",
      book: "Rom"
    });

    expect(searchKeyword.mock.calls[0][0]).toEqual(expect.objectContaining({ query: "donkey" }));
    expect(searchKeyword.mock.calls[0][0].book).toBeUndefined();
    expect(searchKeyword.mock.calls[0][0].chapter).toBeUndefined();
  });

  it("keeps explicit morphology prompts out of keyword and semantic search when no topic remains", async () => {
    await runRetrievalPlan({
      ...emptySignals,
      morphCodes: [{ code: "V-PAI-3S", mode: "exact" }],
      intent: "morphology",
      book: "1Pet"
    });

    expect(searchMorphology).toHaveBeenCalledWith(
      expect.objectContaining({ morphCode: "V-PAI-3S", matchMode: "exact", book: "1Pet" })
    );
    expect(searchKeyword).not.toHaveBeenCalled();
    expect(searchSemanticDetailed).not.toHaveBeenCalled();
  });

  it("runs the REAL signal extraction for a morphology prompt without injecting keyword/semantic noise", async () => {
    // Guards against re-removing `forms` from STOP_WORDS: unlike the test above (which
    // forces topicWords: []), this drives the planner through extractSignals on a real
    // prompt. `forms` must stay filtered so a morphology request does not spawn a stray
    // searchKeyword("forms") + semantic call alongside the morphology search.
    await runRetrievalPlan(extractSignals("find V-PAI-3S forms in 1 Peter"));

    expect(searchMorphology).toHaveBeenCalledWith(
      expect.objectContaining({ morphCode: "V-PAI-3S", matchMode: "exact", book: "1Pet" })
    );
    expect(searchKeyword).not.toHaveBeenCalled();
    expect(searchSemanticDetailed).not.toHaveBeenCalled();
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
    // The ceiling cut the span short, so an explicit truncation marker is shown
    // (not a fetched-prefix "(N more)" count that could imply completeness).
    expect(packet.formattedEvidence).toContain("truncated at");
    // No phantom traces: the tool trace lists only chapters actually fetched, so
    // the synthesis model is never told about chapters absent from the evidence.
    const passageTraces = packet.toolTrace.filter((t) => t.tool === "getPassage");
    expect(passageTraces.length).toBe(getPassage.mock.calls.length);
  });

  it("stops fetching once a chapter past the book end returns no rows", async () => {
    // Only chapter 1 exists (e.g. a single-chapter book like 2 John); later
    // chapters in a pathological span come back empty.
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references:
        input.chapter === 1
          ? [{ book: input.book, chapter: 1, verse: 1, reference: `${input.book} 1:1`, text: "t" }]
          : []
    }));

    await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "2John", chapter: 1, verseStart: 1, chapterEnd: 999_999_999, verseEnd: 1 }],
      intent: "passage-study"
    });

    // ch1 (rows) then ch2 (empty → stop): ~2 fetches per corpus, NOT one empty
    // query per clamped segment. The verse ceiling never trips when rows are empty.
    expect(getPassage.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("caps total assembled evidence so the fallback answer stays within save limits", async () => {
    // Each passage section is large; four references' worth together exceed the
    // evidence budget, so the assembled text must be bounded with a marker.
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references: Array.from({ length: 120 }, (_, i) => ({
        book: input.book, chapter: input.chapter, verse: i + 1,
        reference: `${input.book} ${input.chapter}:${i + 1}`, text: "x".repeat(200)
      }))
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [
        { book: "John", chapter: 1 },
        { book: "Rom", chapter: 8 },
        { book: "Matt", chapter: 5 },
        { book: "Luke", chapter: 1 }
      ],
      intent: "passage-study"
    });

    // Bounded well under the 64K answer cap, with an honest omission marker.
    expect(packet.formattedEvidence.length).toBeLessThanOrEqual(60_000);
    expect(packet.formattedEvidence).toContain("further evidence omitted");
  });

  it("does not trim evidence that fits within the budget", async () => {
    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "John", chapter: 1 }],
      intent: "passage-study"
    });
    expect(packet.formattedEvidence).not.toContain("further evidence omitted");
  });

  it("scans past an empty starting segment to reach a valid later chapter", async () => {
    // An out-of-range starting verse makes the first chapter come back empty, but
    // the later chapter in the range is valid and must not be dropped.
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => ({
      corpus: input.corpus,
      references:
        input.chapter >= 2
          ? [{ book: input.book, chapter: input.chapter, verse: 3, reference: `${input.book} ${input.chapter}:3`, text: "valid tail" }]
          : []
    }));

    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "John", chapter: 1, verseStart: 999, chapterEnd: 2, verseEnd: 3 }],
      intent: "passage-study"
    });

    expect(packet.formattedEvidence).toContain("John 2:3");
    expect(packet.formattedEvidence).not.toContain("(no matches)");
  });

  it("labels a same-chapter verse-range passage with the range, not just the chapter", async () => {
    const packet = await runRetrievalPlan({
      ...emptySignals,
      references: [{ book: "Rom", chapter: 8, verseStart: 1, verseEnd: 4 }],
      intent: "passage-study"
    });

    expect(packet.formattedEvidence).toContain("getPassage(Rom 8:1-4");
  });

  it("adds a searchDomain call for an explicit domain query", async () => {
    vi.mocked(searchDomain).mockResolvedValue({
      filter: { kind: "domain", value: "033" },
      count: 2,
      pagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 },
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
      ]
    } as never);

    const packet = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general", domainQuery: { kind: "domain", code: "033" } } as never,
      "show me domain 33",
      false
    );

    expect(packet.toolTrace.some((t) => t.tool === "searchDomain")).toBe(true);
    expect(packet.formattedEvidence).toContain("searchDomain(domain 033");
    expect(vi.mocked(searchDomain)).toHaveBeenCalled();
  });

  it("forwards the domain code to searchDomain for a domain-kind query", async () => {
    vi.mocked(searchDomain).mockResolvedValue({
      filter: { kind: "domain", value: "033" },
      count: 1,
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
      ]
    } as never);

    await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general", domainQuery: { kind: "domain", code: "033" } } as never,
      "show me domain 33",
      false
    );

    expect(vi.mocked(searchDomain)).toHaveBeenCalledWith(expect.objectContaining({ domain: "033" }));
  });

  it("adds a searchDomain call for an explicit Louw-Nida (ln) query and forwards the ref", async () => {
    vi.mocked(searchDomain).mockResolvedValue({
      filter: { kind: "ln", value: "33.55" },
      count: 1,
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
      ]
    } as never);

    const packet = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general", domainQuery: { kind: "ln", ref: "33.55" } } as never,
      "uses of LN 33.55",
      false
    );

    expect(packet.toolTrace.some((t) => t.tool === "searchDomain")).toBe(true);
    expect(vi.mocked(searchDomain)).toHaveBeenCalledWith(expect.objectContaining({ ln: "33.55" }));
    expect(packet.formattedEvidence).toContain("searchDomain(ln 33.55");
  });

  it("forwards the book scope to searchDomain for a scoped domain query", async () => {
    vi.mocked(searchDomain).mockResolvedValue({
      filter: { kind: "domain", value: "033" },
      count: 1,
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
      results: [
        { tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "Ἐν ἀρχῇ ἦν ὁ λόγος" }
      ]
    } as never);

    await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general", book: "John", domainQuery: { kind: "domain", code: "033" } } as never,
      "domain 33 in John",
      false
    );

    expect(vi.mocked(searchDomain)).toHaveBeenCalledWith(expect.objectContaining({ domain: "033", book: "John" }));
  });

  it("keeps the explicit domain call even when many topic words crowd the plan", async () => {
    vi.mocked(searchDomain).mockResolvedValue({
      filter: { kind: "domain", value: "033" },
      count: 1,
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
      results: [{ tokenId: "t1", corpus: "SBLGNT", reference: "John 1:1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", verseText: "…" }]
    } as never);

    const topicWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "mu", "nu"];
    const packet = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords, morphCodes: [], intent: "general", domainQuery: { kind: "domain", code: "033" } } as never,
      `domain 33 ${topicWords.join(" ")}`,
      false
    );

    expect(packet.toolTrace.some((t) => t.tool === "searchDomain")).toBe(true);
  });

  it("annotates a ≤25-verse SBLGNT passage with per-token morphology/gloss", async () => {
    getPassage.mockResolvedValue({
      corpus: "SBLGNT",
      references: [{ book: "John", chapter: 1, verse: 1, reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος" }]
    });
    getPassageTokens.mockResolvedValue([
      { surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "N-", gloss: "word", domainLabel: "Communication (33)", verse: 1, wordIndex: 4 }
    ]);
    const signals = extractSignals("Show John 1:1");
    const packet = await runRetrievalPlan(signals, "Show John 1:1", false);
    expect(packet.formattedEvidence).toContain('λόγος · λόγος · noun — nominative singular masculine · "word"');
  });

  it("does NOT annotate a >25-verse passage", async () => {
    const refs = Array.from({ length: 30 }, (_, i) => ({ book: "John", chapter: 1, verse: i + 1, reference: `John 1:${i + 1}`, text: "…" }));
    getPassage.mockResolvedValue({ corpus: "SBLGNT", references: refs });
    getPassageTokens.mockResolvedValue([]);
    const signals = extractSignals("Show John 1");
    await runRetrievalPlan(signals, "Show John 1", false);
    expect(getPassageTokens).not.toHaveBeenCalled();
  });

  it("degrades later passages to verse-text-only once the enrichment char budget is spent", async () => {
    vi.stubEnv("TEXTLAB_MAX_ENRICH_CHARS", "120"); // only the first passage's annotation fits
    getPassage.mockImplementation(async ({ book, corpus }: { book: string; corpus: "SBLGNT" | "WEB" }) => ({
      corpus,
      references: [{ book, chapter: 1, verse: 1, reference: `${book} 1:1`, text: "Ἐν ἀρχῇ ἦν ὁ λόγος" }]
    }));
    getPassageTokens.mockResolvedValue([
      { surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "N-", gloss: "word", domainLabel: "Communication (33)", verse: 1, wordIndex: 4 }
    ]);
    const signals = extractSignals("Compare John 1:1 and Mark 1:1");
    const packet = await runRetrievalPlan(signals, "Compare John 1:1 and Mark 1:1", false);
    expect(packet.formattedEvidence).toContain("John 1:1");   // both passages still present
    expect(packet.formattedEvidence).toContain("Mark 1:1");
    const annotated = packet.formattedEvidence.split("noun — nominative singular masculine").length - 1;
    expect(annotated).toBe(1);                                // only the first was enriched (budget spent)
  });

  it("fails open to the base passage when getPassageTokens rejects (degrade, never drop)", async () => {
    getPassage.mockResolvedValue({
      corpus: "SBLGNT",
      references: [{ book: "John", chapter: 1, verse: 1, reference: "John 1:1", text: "Ἐν ἀρχῇ ἦν ὁ λόγος" }]
    });
    getPassageTokens.mockRejectedValue(new Error("token db down"));
    const signals = extractSignals("Show John 1:1");
    const packet = await runRetrievalPlan(signals, "Show John 1:1", false);
    expect(packet.formattedEvidence).toContain("John 1:1, SBLGNT: Ἐν ἀρχῇ ἦν ὁ λόγος"); // base passage kept
    expect(packet.formattedEvidence).not.toContain("noun — nominative singular masculine"); // no annotations
    expect(packet.toolTrace.some((t) => t.tool === "getPassageTokens" && t.error)).toBe(true); // failure traced
  });

  it("does not let enrichment evict a later base passage (reserve base headroom)", async () => {
    // Two large SBLGNT passages whose base text together fits under MAX_EVIDENCE_CHARS,
    // but would exceed it if the first is enriched — the later base must survive.
    getPassage.mockImplementation(async ({ book, corpus }: { book: string; corpus: "SBLGNT" | "WEB" }) => ({
      corpus,
      references: [{
        book, chapter: 1, verse: 1, reference: `${book} 1:1`,
        text: corpus === "SBLGNT" ? (book === "John" ? "α".repeat(42000) : "β".repeat(15000)) : "web"
      }]
    }));
    getPassageTokens.mockImplementation(async ({ book }: { book: string }) =>
      book === "John"
        ? Array.from({ length: 20 }, (_, i) => ({
            surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM", partOfSpeech: "N-",
            gloss: "word", domainLabel: "Communication (33)", verse: 1, wordIndex: i
          }))
        : []
    );
    const signals = extractSignals("Compare John 1:1 and Mark 1:1");
    const packet = await runRetrievalPlan(signals, "Compare John 1:1 and Mark 1:1", false);
    expect(packet.formattedEvidence).toContain("Mark 1:1"); // later base passage NOT evicted by earlier enrichment
    expect(packet.formattedEvidence).not.toContain("noun — nominative singular masculine"); // enrichment suppressed to protect base
  });

  it("decodes the morph code and appends the gloss on lemma evidence", async () => {
    searchLemma.mockResolvedValue({
      lemma: "λόγος", count: 1,
      results: [{ reference: "John 1:1", surface: "λόγος", morphCode: "N-NSM", gloss: "word", verseText: "Ἐν ἀρχῇ…", corpus: "SBLGNT", tokenId: "t1" }],
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 }
    });
    const signals = extractSignals("How is λόγος used?");
    const packet = await runRetrievalPlan(signals, "How is λόγος used?", false);
    expect(packet.formattedEvidence).toContain("noun — nominative singular masculine");
    expect(packet.formattedEvidence).toContain('"word"');
  });
});

describe("shouldRunSemantic", () => {
  const base: Signals = { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "general" };

  it("fires when there are topic words and no exact verse reference", () => {
    expect(shouldRunSemantic({ ...base, topicWords: ["reconciliation"] })).toBe(true);
  });

  it("does not fire without topic words", () => {
    expect(shouldRunSemantic(base)).toBe(false);
  });

  it("fires on a phrase-only concept regardless of intent (phrase term present)", () => {
    // "What is sexual immorality?" / "verses about sexual immorality": the matched
    // phrase is stripped from topicWords but recorded in phraseTerms.
    expect(shouldRunSemantic({ ...base, intent: "general", phraseTerms: ["sexual immorality"] })).toBe(true);
    expect(shouldRunSemantic({ ...base, intent: "topic-survey", phraseTerms: ["sexual immorality"] })).toBe(true);
  });

  it("does not fire on a termless prompt with no topic words or phrase terms", () => {
    // A bare book survey ("themes in Hebrews") routes to getTopLemmas instead.
    expect(shouldRunSemantic({ ...base, intent: "topic-survey", book: "Heb" })).toBe(false);
  });

  it("does not fire on a phrase-only concept when all references are exact verses", () => {
    expect(
      shouldRunSemantic({
        ...base,
        phraseTerms: ["sexual immorality"],
        references: [{ book: "1Cor", chapter: 6, verseStart: 18 }]
      })
    ).toBe(false);
  });

  it("does not fire for a single exact verse reference", () => {
    expect(
      shouldRunSemantic({
        ...base,
        topicWords: ["reconciliation"],
        references: [{ book: "2Cor", chapter: 5, verseStart: 18 }]
      })
    ).toBe(false);
  });

  it("does not fire when ALL references are exact verses (multi-verse pin)", () => {
    expect(
      shouldRunSemantic({
        ...base,
        topicWords: ["grace"],
        references: [
          { book: "Rom", chapter: 3, verseStart: 23 },
          { book: "Eph", chapter: 2, verseStart: 8 }
        ]
      })
    ).toBe(false);
  });

  it("still fires for a bare-chapter reference (no verseStart)", () => {
    expect(
      shouldRunSemantic({ ...base, topicWords: ["love"], references: [{ book: "John", chapter: 1 }] })
    ).toBe(true);
  });
});

describe("semanticCall via runRetrievalPlan", () => {
  it("keeps broad entity words in semantic context instead of deterministic lemma evidence", async () => {
    for (const entity of ["jesus", "christ", "god", "lord"] as const) {
      vi.clearAllMocks();
      searchSemanticDetailed.mockResolvedValue(semanticResult([]));

      const prompt = `what does ${entity} say about prayer`;
      await runRetrievalPlan(extractSignals(prompt), prompt);

      expect(searchLemma).not.toHaveBeenCalledWith(
        expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA[entity] })
      );
      for (const prayerLemma of ENGLISH_TO_GREEK_LEMMA.prayer as readonly string[]) {
        expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: prayerLemma }));
      }
      expect(searchSemanticDetailed).toHaveBeenCalledWith(
        expect.objectContaining({ query: prompt, keywords: "prayer" })
      );
    }
  });

  it("uses broad entity lemma evidence for mention-count prompts", async () => {
    const prompt = "how many times is Jesus mentioned";

    await runRetrievalPlan(extractSignals(prompt), prompt);

    expect(searchLemma).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA.jesus })
    );
  });

  it("fans out a multi-lemma topic word to one lemma search per form", async () => {
    const prompt = "verses about Jerusalem";

    await runRetrievalPlan(extractSignals(prompt), prompt, false);

    const [hebraic, hellenized] = ENGLISH_TO_GREEK_LEMMA.jerusalem as readonly string[];
    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: hebraic }));
    expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: hellenized }));
  });

  it("keeps a broad entity as the real topic in teaching-about-broad-entity prompts", async () => {
    const prompt = "what does the Bible teach about Jesus";

    await runRetrievalPlan(extractSignals(prompt), prompt);

    expect(searchKeyword).not.toHaveBeenCalledWith(expect.objectContaining({ query: "teach" }));
    expect(searchLemma).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA.jesus })
    );
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: prompt, keywords: "jesus" })
    );
  });

  it("preserves local lemma fallback for broad-entity-only prompts when semantic is disabled", async () => {
    const prompt = "verses about Jesus";

    await runRetrievalPlan(extractSignals(prompt), prompt, false);

    expect(searchSemanticDetailed).not.toHaveBeenCalled();
    expect(searchLemma).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA.jesus })
    );
  });

  it("treats teach as framing in teaching-about prompts without dropping the real topic", async () => {
    const prompt = "what did jesus teach about prayer";

    await runRetrievalPlan(extractSignals(prompt), prompt);

    expect(searchKeyword).not.toHaveBeenCalledWith(expect.objectContaining({ query: "teach" }));
    for (const prayerLemma of ENGLISH_TO_GREEK_LEMMA.prayer as readonly string[]) {
      expect(searchLemma).toHaveBeenCalledWith(expect.objectContaining({ lemma: prayerLemma }));
    }
    expect(searchLemma).not.toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA.jesus })
    );
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: prompt, keywords: "prayer" })
    );
  });

  it("treats a known phrase as the narrower topic when paired with a broad entity", async () => {
    const prompt = "what did Jesus teach about sexual immorality";

    await runRetrievalPlan(extractSignals(prompt), prompt);

    expect(searchKeyword).not.toHaveBeenCalledWith(expect.objectContaining({ query: "teach" }));
    expect(searchLemma).not.toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_TO_GREEK_LEMMA.jesus })
    );
    expect(searchLemma).toHaveBeenCalledWith(
      expect.objectContaining({ lemma: ENGLISH_PHRASE_TO_GREEK_LEMMA["sexual immorality"] })
    );
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: prompt, keywords: "sexual immorality" })
    );
  });

  it("keeps teach as keyword evidence when teaching itself is the topic", async () => {
    const prompt = "who is qualified to teach in the church";

    await runRetrievalPlan(extractSignals(prompt), prompt);

    expect(searchKeyword).toHaveBeenCalledWith(expect.objectContaining({ query: "teach" }));
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: prompt, keywords: expect.stringContaining("teach") })
    );
  });

  it("expands each hit to an on-spine ±2 window with paired SBLGNT and WEB lines", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "Eph 2:16", corpus: "WEB", text: "reconcile" }])
    );
    // SBL window 14..18 has 14,15,16,17,18; WEB has the same → paired display lines.
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number; verseStart: number; verseEnd: number }) => ({
      corpus: input.corpus,
      references: [14, 15, 16, 17, 18].map((verse) => ({
        book: input.book,
        chapter: input.chapter,
        verse,
        reference: `${input.book} ${input.chapter}:${verse}`,
        text: `${input.corpus} ${verse}`
      }))
    }));

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["reconciliation"], morphCodes: [], intent: "general" },
      "what does Paul say about reconciliation"
    );

    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: "what does Paul say about reconciliation", keywords: "reconciliation" })
    );
    expect(evidence.formattedEvidence).toContain("Eph 2:16, WEB:");
    expect(evidence.formattedEvidence).toContain("Eph 2:16, SBLGNT:");
    expect(evidence.formattedEvidence).toContain("Eph 2:14, WEB:"); // ±2 neighbor
    expect(evidence.formattedEvidence).toContain("Eph 2:14, SBLGNT:"); // paired SBL text
    expect(evidence.citations).toContainEqual(
      expect.objectContaining({ reference: "Eph 2:16", corpus: "SBLGNT", toolName: "searchSemantic" })
    );
    expect(
      evidence.citations.some((c) => c.reference === "Eph 2:16" && c.corpus === "WEB" && c.toolName === "searchSemantic")
    ).toBe(false);
  });

  it("includes exact SBLGNT Greek beside WEB semantic context for prayer hits", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "Matt 6:5", corpus: "WEB", text: "pray in secret" }])
    );
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => {
      if (input.corpus === "SBLGNT") {
        return {
          corpus: "SBLGNT",
          references: [5].map((verse) => ({
            book: input.book,
            chapter: input.chapter,
            verse,
            reference: `${input.book} ${input.chapter}:${verse}`,
            text: "Καὶ ὅταν ⸂προσεύχησθε, οὐκ ἔσεσθε ὡς⸃ οἱ ὑποκριταί"
          }))
        };
      }
      return {
        corpus: "WEB",
        references: [5].map((verse) => ({
          book: input.book,
          chapter: input.chapter,
          verse,
          reference: `${input.book} ${input.chapter}:${verse}`,
          text: "When you pray, you shall not be as the hypocrites"
        }))
      };
    });

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["jesus", "prayer"], morphCodes: [], intent: "general" },
      "what did Jesus teach about prayer?"
    );

    expect(evidence.formattedEvidence).toContain("Matt 6:5, SBLGNT:");
    expect(evidence.formattedEvidence).toContain("Καὶ ὅταν ⸂προσεύχησθε");
    expect(evidence.formattedEvidence).toContain("Matt 6:5, WEB:");
    expect(evidence.formattedEvidence).toContain("When you pray");
  });

  it("keeps the semantic call when many topic words would otherwise saturate the plan", async () => {
    // 9 unmapped topic words → 9 keyword calls; with MAX_PLANNED_CALLS = 8 the
    // semantic call must still survive the slice because it is added first.
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "John 3:16", corpus: "WEB", text: "loved" }])
    );
    const manyWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"];

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: manyWords, morphCodes: [], intent: "general" },
      "a long conceptual prompt about many things"
    );

    expect(searchSemanticDetailed).toHaveBeenCalled();
    expect(evidence.formattedEvidence).toContain("(semantic hit)");
  });

  it("records keywords and rerank state in the semantic tool trace", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "Eph 2:16", corpus: "WEB", text: "mercy" }], "applied")
    );
    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["mercy"], morphCodes: [], intent: "general" },
      "what is mercy"
    );
    const trace = evidence.toolTrace.find((t) => t.tool === "searchSemantic");
    expect(trace?.args).toMatchObject({
      keywords: "mercy",
      rerankStatus: "applied",
      rerankCandidateCount: 1
    });
  });

  it("omits a window verse missing from the SBL spine", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "Acts 8:36", corpus: "WEB", text: "what hinders" }])
    );
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => {
      if (input.corpus === "SBLGNT") {
        // SBL lacks 8:37 (WEB-only verse) → window returns 34,35,36,38.
        return {
          corpus: "SBLGNT",
          references: [34, 35, 36, 38].map((verse) => ({
            book: input.book, chapter: input.chapter, verse,
            reference: `${input.book} ${input.chapter}:${verse}`, text: `SBLGNT ${verse}`
          }))
        };
      }
      return {
        corpus: "WEB",
        references: [34, 35, 36, 37, 38].map((verse) => ({
          book: input.book, chapter: input.chapter, verse,
          reference: `${input.book} ${input.chapter}:${verse}`, text: `WEB ${verse}`
        }))
      };
    });

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["baptism"], morphCodes: [], intent: "general" },
      "is baptism required"
    );

    expect(evidence.formattedEvidence).toContain("Acts 8:36, WEB:");
    expect(evidence.formattedEvidence).not.toContain("Acts 8:37"); // WEB-only neighbor dropped
  });

  it("forwards the English phrase as FTS keywords for a phrase-only prompt (hybrid, not vector-only)", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(semanticResult([]));
    await runRetrievalPlan(
      { references: [], greekWords: ["πορνεία"], topicWords: [], morphCodes: [], intent: "general", phraseTerms: ["sexual immorality"] },
      "What is sexual immorality?"
    );
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: "What is sexual immorality?", keywords: "sexual immorality" })
    );
  });

  it("preserves quoted phrase terms in semantic FTS keywords", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(semanticResult([]));
    await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: [], morphCodes: [], intent: "topic-survey", phraseTerms: ['"new creation"'] },
      'verses about "new creation"'
    );

    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'verses about "new creation"', keywords: '"new creation"' })
    );
  });

  it("threads chapter scope into semantic search for a single-bare-chapter prompt", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(semanticResult([]));
    await runRetrievalPlan(
      { references: [{ book: "John", chapter: 3 }], greekWords: [], topicWords: ["love"], morphCodes: [], intent: "passage-study" },
      "verses about love in John 3"
    );
    expect(searchSemanticDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ book: "John", chapter: 3, keywords: "love" })
    );
  });

  it("preserves all deterministic slots when semantic is enabled but returns no hits (degraded index)", async () => {
    // Live mode on, but the embedding index yields nothing (empty/partial/rollout).
    searchSemanticDetailed.mockResolvedValue(semanticResult([]));
    const eightWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: eightWords, morphCodes: [], intent: "general" },
      "a long conceptual prompt",
      true // semanticEnabled
    );

    expect(searchSemanticDetailed).toHaveBeenCalled(); // attempted
    expect(evidence.formattedEvidence).not.toContain("(semantic hit)");
    // Empty semantic result contributes no section (no "(no matches)" noise)…
    expect(evidence.formattedEvidence).not.toContain("searchSemantic — top hits");
    // …and crucially never displaces a deterministic search: all 8 keyword slots run.
    for (const w of eightWords) {
      expect(evidence.formattedEvidence).toContain(`searchKeyword(${w}`);
    }
  });

  it("does not call searchSemantic or consume a plan slot when semantic retrieval is disabled", async () => {
    // Even if searchSemantic WOULD return a hit, a disabled (no key / kill switch)
    // run must not call it (no embedding egress) and must not steal a deterministic slot.
    searchSemanticDetailed.mockResolvedValue(
      semanticResult([{ reference: "John 3:16", corpus: "WEB", text: "x" }])
    );
    const eightWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: eightWords, morphCodes: [], intent: "general" },
      "a long conceptual fallback prompt",
      false // semanticEnabled = false
    );

    expect(searchSemanticDetailed).not.toHaveBeenCalled();
    expect(evidence.formattedEvidence).not.toContain("(semantic hit)");
    // All 8 deterministic keyword slots are preserved (none crowded out by a no-op call).
    for (const w of eightWords) {
      expect(evidence.formattedEvidence).toContain(`searchKeyword(${w}`);
    }
  });

  it("labels an SBL-only window verse as SBLGNT, never WEB (corpus fallback)", async () => {
    searchSemanticDetailed.mockResolvedValueOnce(
      semanticResult([{ reference: "Luke 1:36", corpus: "WEB", text: "Elizabeth" }])
    );
    getPassage.mockImplementation(async (input: { corpus: string; book: string; chapter: number }) => {
      if (input.corpus === "SBLGNT") {
        return {
          corpus: "SBLGNT",
          references: [35, 36, 37].map((verse) => ({
            book: input.book, chapter: input.chapter, verse,
            reference: `${input.book} ${input.chapter}:${verse}`, text: `GREEK ${verse}`
          }))
        };
      }
      // WEB lacks verse 35 → its window line must fall back to Greek labeled SBLGNT.
      return {
        corpus: "WEB",
        references: [36, 37].map((verse) => ({
          book: input.book, chapter: input.chapter, verse,
          reference: `${input.book} ${input.chapter}:${verse}`, text: `ENGLISH ${verse}`
        }))
      };
    });

    const evidence = await runRetrievalPlan(
      { references: [], greekWords: [], topicWords: ["kinship"], morphCodes: [], intent: "general" },
      "how are Mary and Elizabeth related"
    );

    expect(evidence.formattedEvidence).toContain("Luke 1:35, SBLGNT: GREEK 35"); // SBL-only → Greek labeled SBLGNT
    expect(evidence.formattedEvidence).toContain("Luke 1:36, WEB: ENGLISH 36"); // WEB present → WEB
  });
});
