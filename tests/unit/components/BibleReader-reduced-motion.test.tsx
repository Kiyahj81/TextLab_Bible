// tests/unit/components/BibleReader-reduced-motion.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader reduced motion", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}
    }));
  });

  it("scrolls without smooth behavior when reduced motion is preferred", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" targetVerse={1} />);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
