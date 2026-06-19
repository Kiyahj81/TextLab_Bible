// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ContinuousReader } from "@/components/ContinuousReader";

const noop = vi.fn();
const handlers = {
  selectedTokenId: null, setSelectedTokenId: noop, tokenColorOverride: {}, onHighlightToken: noop,
  tokenNoteDrafts: {}, onTokenDraft: noop, onNotesChanged: noop,
  selectedEnglishWord: null, setSelectedEnglishWord: noop, englishColorOverride: {},
  onPickEnglish: noop, onClearEnglish: noop
};
const token = (id: string, surface: string, verse: number) => ({
  id, book: "John", chapter: 1, verse, wordIndex: 0, surface, normalized: surface,
  lemma: surface, morphCode: "P", partOfSpeech: "P-", gloss: "", domains: [], noteCount: 0, notes: [], highlightColor: null
});
const verses = [
  { id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
    greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
    englishHighlights: [], tokens: [token("t1", "Ἐν", 1)],
    notes: [{ id: "n1", title: null, body: "verse one note", tags: ["verse"] }] },
  { id: "v2", book: "John", bookName: "John", chapter: 1, verse: 2, reference: "John 1:2",
    greekText: "οὗτος", englishText: "He", englishCorpus: "WEB", englishVerseId: "e2",
    englishHighlights: [], tokens: [token("t2", "οὗτος", 2)], notes: [] }
];

afterEach(cleanup);

describe("ContinuousReader verse-note indicator", () => {
  it("shows the icon only on noted verses (greek) and opens the note", () => {
    const { getByRole, queryByRole, getByText } = render(<ContinuousReader verses={verses} mode="greek" {...handlers} />);
    expect(getByRole("button", { name: /notes on john 1:1/i })).toBeTruthy();
    expect(queryByRole("button", { name: /notes on john 1:2/i })).toBeNull();
    fireEvent.click(getByRole("button", { name: /notes on john 1:1/i }));
    expect(getByText("verse one note")).toBeTruthy();
  });

  it("shows the icon in english mode too", () => {
    const { getByRole, queryByRole } = render(<ContinuousReader verses={verses} mode="english" {...handlers} />);
    expect(getByRole("button", { name: /notes on john 1:1/i })).toBeTruthy();
    expect(queryByRole("button", { name: /notes on john 1:2/i })).toBeNull();
  });
});
