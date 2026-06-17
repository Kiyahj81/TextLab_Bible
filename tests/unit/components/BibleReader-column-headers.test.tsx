// tests/unit/components/BibleReader-column-headers.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const mk = (n: number) => ({
  id: `v${n}`, book: "John", bookName: "John", chapter: 1, verse: n, reference: `John 1:${n}`,
  greekText: "x", englishText: "y", englishCorpus: "WEB", englishVerseId: `e${n}`,
  englishHighlights: [], tokens: []
});

describe("BibleReader column headers", () => {
  it("shows the corpus label once, not once per verse", () => {
    const { getAllByText } = render(
      <BibleReader verses={[mk(1), mk(2), mk(3)]} initialMode="parallel" chapterLabel="John 1" />
    );
    expect(getAllByText("SBLGNT").length).toBe(1);
    expect(getAllByText("WEB").length).toBe(1);
  });
});
