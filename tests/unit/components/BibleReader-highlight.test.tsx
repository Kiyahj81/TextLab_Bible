// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

const token = {
  id: "t1", book: "John", chapter: 1, verse: 1, wordIndex: 0,
  surface: "Ἐν", normalized: "εν", lemma: "ἐν", morphCode: "P", partOfSpeech: "P-",
  gloss: "in", domains: [], noteCount: 0, notes: [], highlightColor: null
};
const verse = {
  id: "v1", book: "John", bookName: "John", chapter: 1, verse: 1, reference: "John 1:1",
  greekText: "Ἐν", englishText: "In", englishCorpus: "WEB", englishVerseId: "e1",
  englishHighlights: [], tokens: [token], notes: []
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
    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));          // open popover
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));  // apply default color
    const tokenBtn = getByRole("button", { name: "Ἐν" });
    expect(tokenBtn.getAttribute("style")).toMatch(/background-color/);
  });

  it("reverts and shows an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    const { getByRole, findByText } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);
    fireEvent.click(getByRole("button", { name: "Ἐν" }));
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
    expect(await findByText(/could not save highlight/i)).toBeTruthy();
    expect(getByRole("button", { name: "Ἐν" }).getAttribute("style") ?? "").not.toMatch(/background-color/);
  });

  it("surfaces a failed highlight in continuous mode (no per-verse status containers)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));
    const { getByRole, findByText } = render(
      <BibleReader verses={[verse]} initialMode="greek" initialLayout="continuous" chapterLabel="John 1" />
    );
    fireEvent.click(getByRole("button", { name: "Ἐν" }));          // open popover
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));  // apply default color (request fails)
    expect(await findByText(/could not save highlight/i)).toBeTruthy();
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

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);

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

    const { getByRole, queryByText } = render(<BibleReader verses={[verse]} initialMode="english" chapterLabel="John 1" />);

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

    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);

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

    const { getByRole } = render(<BibleReader verses={[verse]} initialMode="english" chapterLabel="John 1" />);

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

  it("Greek: queued write is not dispatched by a local timeout while the first write is unresolved", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string, init: RequestInit) => {
        if (fetchMock.mock.calls.length === 1) {
          const signal = init.signal;
          return new Promise<{ ok: boolean }>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        return Promise.resolve({ ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { getByRole } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);

      fireEvent.click(getByRole("button", { name: "Ἐν" }));
      fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_500);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BibleReader confirmed-color rollback", () => {
  // RED→GREEN regression: when BOTH A and B fail, rollback must use the confirmed color
  // (null, i.e. server value / no highlight) rather than A's optimistic color.
  // On the OLD code `prev` was read from optimistic state, so B's failure would roll back
  // to A's speculative color (never persisted), leaving a phantom highlight.

  it("Greek: A fails then B fails — rolls back to original null, not A's speculative color", async () => {
    // Both fetches return { ok: false }. Serialized: A fires, B waits, A settles with failure,
    // B fires, B settles with failure. After both settle, confirmed is still null (no write ever
    // succeeded), so the token button must have no background-color.
    let resolveA!: (v: { ok: boolean }) => void;
    let resolveB!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveA = r; })) // A
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveB = r; })); // B
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, findByText } = render(<BibleReader verses={[verse]} initialMode="greek" chapterLabel="John 1" />);

    // Open morphology popover
    fireEvent.click(getByRole("button", { name: "Ἐν" }));

    // Click Highlight — queues A (pending)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));
    // Token should show optimistic color immediately
    expect(getByRole("button", { name: "Ἐν" }).getAttribute("style")).toMatch(/background-color/);

    // Click Highlight again — queues B (waiting for A)
    fireEvent.click(getByRole("button", { name: /^Highlight$/ }));

    // Only A dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A fails — unblocks B
    resolveA({ ok: false });
    // Wait for B to be dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // B fails
    resolveB({ ok: false });

    // After both fail, error status appears and token reverts to no color
    await findByText(/could not save highlight/i);
    await waitFor(() => {
      const style = getByRole("button", { name: "Ἐν" }).getAttribute("style") ?? "";
      expect(style).not.toMatch(/background-color/);
    });
  });

  it("English: A fails then B fails — rolls back to original null, not A's speculative color", async () => {
    // Same scenario for English word. token has no server highlight (englishHighlights: []).
    // Pick Blue (A), pick Green (B), both fail → word button must have no background-color.
    let resolveA!: (v: { ok: boolean }) => void;
    let resolveB!: (v: { ok: boolean }) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveA = r; })) // A
      .mockImplementationOnce(() => new Promise<{ ok: boolean }>((r) => { resolveB = r; })); // B
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, findByText } = render(<BibleReader verses={[verse]} initialMode="english" chapterLabel="John 1" />);

    // Open English word popover, pick Blue (A)
    fireEvent.click(getByRole("button", { name: "In" }));
    fireEvent.click(getByRole("menuitemradio", { name: "Blue" }));

    // Word should show optimistic Blue immediately
    expect(getByRole("button", { name: "In" }).getAttribute("style")).toMatch(/background-color/);

    // Re-open popover, pick Green (B)
    fireEvent.click(getByRole("button", { name: "In" }));
    fireEvent.click(getByRole("menuitemradio", { name: "Green" }));

    // Only A dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A fails — unblocks B
    resolveA({ ok: false });
    // Wait for B to be dispatched
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // B fails
    resolveB({ ok: false });

    // After both fail, error status appears and word reverts to no color
    await findByText(/could not save highlight/i);
    await waitFor(() => {
      const style = getByRole("button", { name: "In" }).getAttribute("style") ?? "";
      expect(style).not.toMatch(/background-color/);
    });
  });
});
