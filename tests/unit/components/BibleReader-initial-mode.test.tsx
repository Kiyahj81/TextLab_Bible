// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BibleReader } from "@/components/BibleReader";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/read",
  useSearchParams: () => new URLSearchParams()
}));

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1,
  reference: "John 1:1", greekText: "Ἐν ἀρχῇ", englishText: "In the beginning",
  englishCorpus: "WEB", englishVerseId: "e1", englishHighlights: [], tokens: []
};

describe("BibleReader initial mode", () => {
  it("renders greek-only on first paint when initialMode=greek (no parallel flash)", () => {
    const { queryByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    expect(queryByText("SBLGNT")).toBeTruthy();
    expect(queryByText("WEB")).toBeNull(); // English column not rendered
  });
});
