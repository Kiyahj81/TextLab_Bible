// tests/unit/components/BibleReader-layout.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: []
};

describe("BibleReader layout", () => {
  it("renders continuous (no per-verse note toggle) for greek", () => {
    const { queryByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="continuous" chapterLabel="John 1" />
    );
    expect(queryByRole("button", { name: /note on john 1:1/i })).toBeNull();
  });
  it("forces study layout in parallel even if continuous was saved", () => {
    const { getByRole } = render(
      <BibleReader verses={[verse]} initialMode="parallel" initialLayout="continuous" chapterLabel="John 1" />
    );
    expect(getByRole("button", { name: /note on john 1:1/i })).toBeTruthy();
  });
});
