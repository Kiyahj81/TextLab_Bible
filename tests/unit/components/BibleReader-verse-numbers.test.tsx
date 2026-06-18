// tests/unit/components/BibleReader-verse-numbers.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

afterEach(() => {
  cleanup();
});

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

  it("renders the inline verse number alongside English text in english mode", () => {
    const { container } = render(
      <BibleReader verses={[verse]} initialMode="english" chapterLabel="John 1" />
    );
    const article = container.querySelector("article");
    expect(article?.textContent).toContain("3");       // inline verse number
    expect(article?.textContent).toContain("All things"); // English text
  });
});
