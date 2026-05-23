import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    verse: { findMany: vi.fn(), findFirst: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ai/modelRouter", async (orig) => {
  const real = await (orig as () => Promise<typeof import("@/lib/ai/modelRouter")>)();
  return {
    ...real,
    isLiveAssistantEnabled: () => false
  };
});

import { answerBibleQuestion, detectBookFromPrompt } from "@/lib/ai/assistant";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.token.groupBy.mockResolvedValue([
    { lemma: "λόγος", partOfSpeech: "N-", _count: { _all: 40 } },
    { lemma: "θεός", partOfSpeech: "N-", _count: { _all: 30 } },
    { lemma: "φῶς", partOfSpeech: "N-", _count: { _all: 20 } }
  ]);
  prismaMock.token.findMany.mockResolvedValue([
    { id: "t1", surface: "λόγος", lemma: "λόγος", morphCode: "N-NSM",
      chapter: 1, verse: 1, book: { id: "bJohn", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } },
    { id: "t2", surface: "θεός", lemma: "θεός", morphCode: "N-NSM",
      chapter: 1, verse: 1, book: { id: "bJohn", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } },
    { id: "t3", surface: "φῶς", lemma: "φῶς", morphCode: "N-NSN",
      chapter: 1, verse: 4, book: { id: "bJohn", osisId: "John" }, corpus: { abbreviation: "SBLGNT" } }
  ]);
  prismaMock.verse.findMany.mockResolvedValue([
    { bookId: "bJohn", chapter: 1, verse: 1, text: "Ἐν ἀρχῇ", corpus: { abbreviation: "SBLGNT" } },
    { bookId: "bJohn", chapter: 1, verse: 4, text: "ἐν αὐτῷ ζωὴ ἦν", corpus: { abbreviation: "SBLGNT" } }
  ]);
});

describe("important-words branch", () => {
  it("issues exactly one token.findMany for example tokens", async () => {
    await answerBibleQuestion("What are the most important words in John?");
    expect(prismaMock.token.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.token.groupBy).toHaveBeenCalledTimes(1);
  });
});

describe("book detection", () => {
  it("ignores substrings inside other words", () => {
    expect(detectBookFromPrompt("from the start")).toBeUndefined();
    expect(detectBookFromPrompt("romance languages")).toBeUndefined();
  });
  it("matches alias word boundaries", () => {
    expect(detectBookFromPrompt("Tell me about Romans 8")).toBe("Rom");
    expect(detectBookFromPrompt("john 1:1")).toBe("John");
    expect(detectBookFromPrompt("1 cor 13")).toBe("1Cor");
  });
});
