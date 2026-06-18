// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ContinuousReader } from "@/components/ContinuousReader";

const token = (id: string, surface: string, verse: number) => ({
  id, book: "John", chapter: 1, verse, wordIndex: 0, surface, normalized: surface,
  lemma: surface, morphCode: "P", partOfSpeech: "P-", gloss: "", domains: [], noteCount: 0, highlightColor: null
});
const verses = [
  { id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
    greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
    englishHighlights: [], tokens: [token("t1", "Ἐν", 1)] },
  { id: "v2", book: "John", bookName: "John", chapter: 1, verse: 2, reference: "John 1:2",
    greekText: "οὗτος", englishText: "He", englishCorpus: "WEB", englishVerseId: "e2",
    englishHighlights: [], tokens: [token("t2", "οὗτος", 2)] }
];
const noop = vi.fn();
const handlers = {
  selectedTokenId: null, setSelectedTokenId: noop, tokenColorOverride: {}, onHighlightToken: noop,
  tokenNoteDrafts: {}, onTokenDraft: noop, onNotesChanged: noop,
  selectedEnglishWord: null, setSelectedEnglishWord: noop, englishColorOverride: {},
  onPickEnglish: noop, onClearEnglish: noop
};

describe("ContinuousReader", () => {
  afterEach(() => cleanup());

  it("flows Greek verses with superscript numbers and no note editors", () => {
    const { container, getByRole, getByText, queryByPlaceholderText } = render(
      <ContinuousReader verses={verses} mode="greek" {...handlers} />
    );
    expect(getByRole("button", { name: "Ἐν" })).toBeTruthy();
    expect(getByRole("button", { name: "οὗτος" })).toBeTruthy();
    expect(queryByPlaceholderText(/write a note/i)).toBeNull();          // no per-verse editors
    expect(container.querySelector("#verse-2")).toBeTruthy();             // jump anchor present
    expect(getByText("John 1:1")).toBeTruthy();                           // sr-only verse reference
  });

  it("keeps whitespace between adjacent Greek tokens in a multi-token verse", () => {
    const multiVerse = [
      { id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
        greekText: "Ἐν ἀρχῇ", englishText: "In the beginning", englishCorpus: "WEB", englishVerseId: "e1",
        englishHighlights: [], tokens: [token("t1", "Ἐν", 1), token("t2", "ἀρχῇ", 1)] }
    ];
    const { container } = render(<ContinuousReader verses={multiVerse} mode="greek" {...handlers} />);
    // Tokens must be space-separated in the text content, not collapsed ("Ἐνἀρχῇ").
    expect(container.textContent).toContain("Ἐν ἀρχῇ");
  });

  it("rings the target verse number and only the target", () => {
    const { container } = render(
      <ContinuousReader verses={verses} mode="greek" targetVerse={2} {...handlers} />
    );
    expect(container.querySelector("#verse-2")?.className).toMatch(/ring-accent-400/);
    expect(container.querySelector("#verse-1")?.className ?? "").not.toMatch(/ring-accent-400/);
  });
});
