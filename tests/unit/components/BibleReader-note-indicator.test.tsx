// tests/unit/components/BibleReader-note-indicator.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

function tok(id: string, surface: string, wordIndex: number, noteCount: number, notes: { id: string; title: string | null; body: string; tags: string[] }[]) {
  return { id, book: "John", chapter: 1, verse: 1, wordIndex, surface, normalized: null, lemma: null, morphCode: null, partOfSpeech: null, gloss: null, domains: [], noteCount, notes, highlightColor: null };
}
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "λόγος καί", englishText: "Word and", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [],
  tokens: [
    tok("t1", "λόγος", 0, 1, [{ id: "n1", title: null, body: "x", tags: ["word"] }]),
    tok("t2", "καί", 1, 0, [])
  ],
  notes: []
};

afterEach(cleanup);

describe("BibleReader token note indicator (study)", () => {
  it("marks a token that has notes and leaves un-noted tokens unmarked", () => {
    const { getByRole, queryByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="study" chapterLabel="John 1" />
    );
    expect(getByRole("button", { name: /λόγος.*has a note/i })).toBeTruthy();
    expect(queryByRole("button", { name: /καί.*has a note/i })).toBeNull();
  });
});
