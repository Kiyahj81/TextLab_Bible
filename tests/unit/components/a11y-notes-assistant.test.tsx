// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiAssistant } from "@/components/AiAssistant";
import { NotesPanel, type NoteRow } from "@/components/NotesPanel";

// These tests pin the accessibility parity between the notes/assistant pages
// and the read/search pages: every editable control has an accessible name,
// and status messages are announced via live regions.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("")
}));

// This project's vitest config does not enable globals, so testing-library's
// auto-cleanup never registers; unmount between tests to avoid duplicate DOM.
afterEach(cleanup);

describe("NotesPanel accessibility", () => {
  const note: NoteRow = {
    id: "1",
    title: "Greeting",
    body: "Note body text",
    tags: ["verse"],
    reference: "John 1:1",
    book: "John",
    chapter: 1,
    verse: 1
  };

  function renderPanel() {
    return render(
      <NotesPanel
        notes={[note]}
        total={1}
        page={1}
        pageSize={20}
        pageCount={1}
        tag=""
        reference=""
        keyword=""
        sort="recent"
      />
    );
  }

  it("gives the per-note title and body editors accessible names", () => {
    renderPanel();
    expect(screen.getByLabelText("Note title")).toBeTruthy();
    expect(screen.getByLabelText("Note body")).toBeTruthy();
  });

  it("keeps the filter controls labelled", () => {
    renderPanel();
    expect(screen.getByLabelText("Keyword")).toBeTruthy();
    expect(screen.getByLabelText("Filter by tag")).toBeTruthy();
    expect(screen.getByLabelText("Filter by reference")).toBeTruthy();
    expect(screen.getByLabelText("Sort")).toBeTruthy();
  });

  it("exposes the result summary as a live region", () => {
    renderPanel();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("1 note");
  });
});

describe("AiAssistant accessibility", () => {
  it("associates the Question label with the prompt textarea", () => {
    render(<AiAssistant initialNotes={[]} />);
    const textarea = screen.getByLabelText("Question");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("exposes the submit control with an accessible name", () => {
    render(<AiAssistant initialNotes={[]} />);
    expect(screen.getByRole("button", { name: /ask assistant/i })).toBeTruthy();
  });
});
