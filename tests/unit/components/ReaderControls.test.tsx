// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ReaderControls } from "@/components/ReaderControls";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const books = [{ osisId: "John", label: "John" }, { osisId: "Rom", label: "Romans" }];
const passages = [
  { book: "John", chapter: 1, label: "John 1" },
  { book: "John", chapter: 2, label: "John 2" },
  { book: "Rom", chapter: 1, label: "Romans 1" }
];

describe("ReaderControls", () => {
  afterEach(() => { cleanup(); });

  it("auto-selects first chapter (by number) when book changes", () => {
    const { getByDisplayValue, getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={2} />
    );
    expect(getByDisplayValue("2")).toBeTruthy();
    fireEvent.change(getByRole("combobox", { name: /book/i }), { target: { value: "Rom" } });
    expect(getByDisplayValue("1")).toBeTruthy();
  });

  it("navigates to a typed reference on submit", () => {
    const { getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={1} />
    );
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "John 3:16" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/read?book=John&chapter=3&verse=16");
  });

  it("shows an error for an unparseable reference", () => {
    const { getByRole, getByText } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={1} />
    );
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "nope" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(getByText(/try a reference like/i)).toBeTruthy();
  });

  it("resyncs the verse field when the verse prop changes (soft nav)", () => {
    const { getByLabelText, rerender } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={1} selectedVerse={5} />
    );
    expect((getByLabelText("verse") as HTMLInputElement).value).toBe("5");
    rerender(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={3} selectedVerse={16} />
    );
    expect((getByLabelText("verse") as HTMLInputElement).value).toBe("16");
  });
});
