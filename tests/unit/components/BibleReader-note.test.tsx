// tests/unit/components/BibleReader-note.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader note affordance", () => {
  it("hides the note editor until the note button is pressed", () => {
    const { queryByPlaceholderText, getByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />
    );
    expect(queryByPlaceholderText(/write a note/i)).toBeNull();
    fireEvent.click(getByRole("button", { name: /note on john 1:1/i }));
    expect(queryByPlaceholderText(/write a note/i)).toBeTruthy();
  });
});
