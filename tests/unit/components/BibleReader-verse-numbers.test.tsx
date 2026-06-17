// tests/unit/components/BibleReader-verse-numbers.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 3, reference: "John 1:3",
  greekText: "πάντα", englishText: "All things", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader verse numbering", () => {
  it("renders no per-verse h2 and labels the article with the reference", () => {
    const { container } = render(
      <BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />
    );
    expect(container.querySelectorAll("h2").length).toBe(0);
    const article = container.querySelector("article");
    expect(article?.getAttribute("aria-label")).toBe("John 1:3");
    expect(article?.textContent).toContain("3"); // inline verse number visible
  });
});
