// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0,
  surface: "Ἐν", normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-",
  gloss: "in", domains: [], noteCount: 0, highlightColor: null
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token]
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BibleReader optimistic highlight", () => {
  it("colors the token immediately when Highlight is applied (no refetch needed)", async () => {
    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));          // open popover
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));  // apply default color
    const tokenBtn = getByRole("button", { name: "Ἐν" });
    expect(tokenBtn.getAttribute("style")).toMatch(/background-color/);
  });

  it("reverts and shows an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    const { getByRole, findByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
    expect(await findByText(/could not save highlight/i)).toBeTruthy();
    expect(getByRole("button", { name: "Ἐν" }).getAttribute("style") ?? "").not.toMatch(/background-color/);
  });
});

describe("BibleReader out-of-order highlight race guard", () => {
  it("Greek: older failing request does NOT roll back a newer successful highlight", async () => {
    // Request A: stays pending (deferred promise)
    // Request B (and onwards): resolves ok immediately
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B: succeed
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);

    // Open morphology popover
    fireEvent.click(getByRole("button", { name: "Ἐν" }));

    // Click "Highlight" once — fires request A (pending)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));

    // Click "Highlight" again — fires request B (resolves ok)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));

    // Wait for B to land
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Now resolve A with failure — the guard must ignore this rollback
    resolveFirst({ ok: false });

    // Wait a tick for any state updates to settle
    await waitFor(() => {
      // Token button STILL has a background-color (B's color survived)
      const tokenBtn = getByRole("button", { name: "Ἐν" });
      expect(tokenBtn.getAttribute("style")).toMatch(/background-color/);
    });

    // No "could not save" status text should have appeared
    expect(queryByText(/could not save highlight/i)).toBeNull();
  });

  it("English: older failing request does NOT roll back a newer successful highlight", async () => {
    // Request A: stays pending (deferred promise)
    // Request B (and onwards): resolves ok immediately
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B: succeed
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="english" />);

    // Open English word popover by clicking the word "In"
    fireEvent.click(getByRole("button", { name: "In" }));

    // Pick a color from the HighlightPalette — fires request A (pending)
    // The first swatch is "Yellow" (aria-label="Yellow")
    fireEvent.click(getByRole("menuitemradio", { name: "Yellow" }));

    // Re-open the popover (picking a color closes it via onClose in EnglishWordPopover)
    fireEvent.click(getByRole("button", { name: "In" }));

    // Pick the "Blue" swatch — fires request B (resolves ok)
    fireEvent.click(getByRole("menuitemradio", { name: "Blue" }));

    // Wait for B to land (2 total fetch calls)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Resolve A with failure — the guard must ignore this rollback
    resolveFirst({ ok: false });

    // Wait for any state updates to settle
    await waitFor(() => {
      // Word button STILL has a background-color (B's color survived)
      const wordBtn = getByRole("button", { name: "In" });
      expect(wordBtn.getAttribute("style")).toMatch(/background-color/);
    });

    // No error status text should have appeared
    expect(queryByText(/could not save highlight/i)).toBeNull();
  });
});
