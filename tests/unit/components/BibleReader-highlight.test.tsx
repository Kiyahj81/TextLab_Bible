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
    // With serialization: A fires, then B waits for A to settle before firing.
    // We resolve A with failure; B then fires and succeeds.
    // The seq guard on A's failure (seq=1) must not roll back B's success (seq=2).
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B: succeed
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="greek" />);

    // Open morphology popover
    fireEvent.click(getByRole("button", { name: "Ἐν" }));

    // Click "Highlight" once — queues request A (pending)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));

    // Click "Highlight" again — queues request B (will fire after A settles)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));

    // Only A should have been dispatched so far (B is waiting in the chain)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Capture the optimistic style (applied immediately for both A and B clicks)
    const winning = getByRole("button", { name: "Ἐν" }).getAttribute("style");
    expect(winning).toMatch(/background-color/);

    // Resolve A with failure — this unblocks B, and the seq guard must ignore A's rollback
    resolveFirst({ ok: false });

    // B should now fire and settle
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The token button must still show the winning style (B's seq wins, A's rollback is blocked)
    await waitFor(() => {
      const tokenBtn = getByRole("button", { name: "Ἐν" });
      expect(tokenBtn.getAttribute("style")).toBe(winning);
    });

    // No "could not save" status text should have appeared (A's seq was stale)
    expect(queryByText(/could not save highlight/i)).toBeNull();
  });

  it("English: older failing request does NOT roll back a newer successful highlight", async () => {
    // With serialization: A fires, B waits. Resolve A with failure; B fires and succeeds.
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B: succeed
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="english" />);

    // Open English word popover by clicking the word "In"
    fireEvent.click(getByRole("button", { name: "In" }));

    // Pick a color from the HighlightPalette — queues request A (pending)
    // The first swatch is "Yellow" (aria-label="Yellow")
    fireEvent.click(getByRole("menuitemradio", { name: "Yellow" }));

    // Re-open the popover (picking a color closes it via onClose in EnglishWordPopover)
    fireEvent.click(getByRole("button", { name: "In" }));

    // Pick the "Blue" swatch — queues request B (will fire after A settles)
    fireEvent.click(getByRole("menuitemradio", { name: "Blue" }));

    // Only A should have been dispatched so far (B is waiting in the chain)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Capture the winning style
    const winning = getByRole("button", { name: "In" }).getAttribute("style");
    expect(winning).toMatch(/background-color/);

    // Resolve A with failure — unblocks B; seq guard must ignore A's rollback
    resolveFirst({ ok: false });

    // B should now fire and settle
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Word button must still show exactly the winning style
    await waitFor(() => {
      const wordBtn = getByRole("button", { name: "In" });
      expect(wordBtn.getAttribute("style")).toBe(winning);
    });

    // No error status text should have appeared
    expect(queryByText(/could not save highlight/i)).toBeNull();
  });
});

describe("BibleReader highlight write serialization", () => {
  it("Greek: second write for the same token is not dispatched until the first settles", async () => {
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" />);

    // Open morphology popover and click Highlight twice
    fireEvent.click(getByRole("button", { name: "Ἐν" }));
    fireEvent.click(getByRole("button", { name: /^Highlight$/ })); // A dispatched
    fireEvent.click(getByRole("button", { name: /^Highlight$/ })); // B queued (not yet dispatched)

    // Only A should have been dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // B must still be queued, not sent
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Settle A
    resolveFirst({ ok: true });

    // B should now be dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("English: second write for the same word is not dispatched until the first settles", async () => {
    let resolveFirst!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveFirst = r; })) // A: pending
      .mockImplementation(() => Promise.resolve({ ok: true }));                                  // B
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="english" />);

    // Open English word popover and pick a color twice
    fireEvent.click(getByRole("button", { name: "In" }));
    fireEvent.click(getByRole("menuitemradio", { name: "Yellow" })); // A dispatched

    // Re-open popover and pick another color
    fireEvent.click(getByRole("button", { name: "In" }));
    fireEvent.click(getByRole("menuitemradio", { name: "Blue" }));   // B queued (not yet dispatched)

    // Only A should have been dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // B must still be queued, not sent
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Settle A
    resolveFirst({ ok: true });

    // B should now be dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
