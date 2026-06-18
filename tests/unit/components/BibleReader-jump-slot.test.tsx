// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [], notes: []
};

describe("BibleReader jump slot", () => {
  it("renders the jumpSlot in the sticky bar", () => {
    const { getByTestId } = render(
      <BibleReader
        verses={[verse]}
        initialMode="greek"
        chapterLabel="John 1"
        jumpSlot={<div data-testid="jump-slot" />}
      />
    );
    expect(getByTestId("jump-slot")).toBeTruthy();
  });
});
