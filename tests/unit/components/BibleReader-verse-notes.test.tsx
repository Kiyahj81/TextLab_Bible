// tests/unit/components/BibleReader-verse-notes.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BibleReader } from "@/components/BibleReader";

const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [],
  notes: [{ id: "n1", title: null, body: "my verse note", tags: ["verse"] }]
};

beforeEach(() => { refresh.mockClear(); vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BibleReader verse notes (study layout)", () => {
  it("renders existing verse notes in study layout", () => {
    const { getByText } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="study" chapterLabel="John 1" />
    );
    expect(getByText("my verse note")).toBeTruthy();
  });

  it("refreshes the passage after saving a new verse note", async () => {
    const { getByRole, getByPlaceholderText } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="study" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: /note on john 1:1/i }));
    fireEvent.change(getByPlaceholderText("Write a note"), { target: { value: "another note" } });
    fireEvent.click(getByRole("button", { name: /^save note$/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
