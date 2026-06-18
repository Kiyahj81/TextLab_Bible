// tests/unit/components/NoteList.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NoteList } from "@/components/NoteList";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const notes = [{ id: "n1", title: "John 1:1", body: "logos = word", tags: ["word"] }];

describe("NoteList", () => {
  it("deletes a note and notifies the caller", async () => {
    const onChanged = vi.fn();
    const { getByRole } = render(<NoteList notes={notes} onChanged={onChanged} />);
    fireEvent.click(getByRole("button", { name: /delete note/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/notes/n1", expect.objectContaining({ method: "DELETE" }));
  });

  it("edits a note via PATCH, preserving title and tags", async () => {
    const onChanged = vi.fn();
    const { getByRole, getByDisplayValue } = render(<NoteList notes={notes} onChanged={onChanged} />);
    fireEvent.click(getByRole("button", { name: /edit note/i }));
    fireEvent.change(getByDisplayValue("logos = word"), { target: { value: "the Word" } });
    fireEvent.click(getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "John 1:1", body: "the Word", tags: ["word"] });
  });
});
