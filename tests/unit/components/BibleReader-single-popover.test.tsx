// tests/unit/components/BibleReader-single-popover.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0, surface: "Ἐν",
  normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-", gloss: "in",
  domains: [], noteCount: 0, notes: [], highlightColor: null
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token], notes: []
};

describe("single active popover", () => {
  it("closes the Greek popover when an English word is opened", () => {
    const { getByRole, queryByText } = render(
      <BibleReader verses={[verse]} initialMode="parallel" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: "Ἐν" }));      // open Greek popover
    expect(queryByText(/morphology/i)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "In" }));      // open English popover
    expect(queryByText(/morphology/i)).toBeNull();             // Greek popover closed
  });
});
