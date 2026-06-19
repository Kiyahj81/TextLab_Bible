// tests/unit/components/BibleReader-token-notes.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0,
  surface: "Ἐν", normalized: null, lemma: "ἐν", morphCode: null,
  partOfSpeech: null, gloss: null, domains: [], noteCount: 1, highlightColor: null,
  notes: [{ id: "tn1", title: "John 1:1 Ἐν", body: "token note body", tags: ["word"] }]
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token], notes: []
};

beforeEach(() => { refresh.mockClear(); vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BibleReader token notes (study layout)", () => {
  it("shows existing token notes in the morphology popover", () => {
    const { getByRole, getByText } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="study" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: /^Ἐν/ }));
    expect(getByText("token note body")).toBeTruthy();
  });

  it("refreshes after deleting a token note", async () => {
    const { getByRole } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="study" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: /^Ἐν/ }));
    fireEvent.click(getByRole("button", { name: /delete note/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/notes/tn1", expect.objectContaining({ method: "DELETE" }));
  });
});
