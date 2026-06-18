// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ReaderControls } from "@/components/ReaderControls";

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
