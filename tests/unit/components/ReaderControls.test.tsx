import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReaderControls } from "@/components/ReaderControls";

const books = [{ osisId: "John", label: "John" }, { osisId: "Rom", label: "Romans" }];
const passages = [
  { book: "John", chapter: 1, label: "John 1" },
  { book: "John", chapter: 2, label: "John 2" },
  { book: "Rom", chapter: 1, label: "Romans 1" }
];

describe("ReaderControls", () => {
  it("auto-selects first chapter when book changes", () => {
    const { getByDisplayValue, getByRole } = render(
      <ReaderControls books={books} passages={passages} selectedBook="John" selectedChapter={2} />
    );
    expect(getByDisplayValue("John 2")).toBeTruthy();
    fireEvent.change(getByRole("combobox", { name: /book/i }), { target: { value: "Rom" } });
    expect(getByDisplayValue("Romans 1")).toBeTruthy();
  });
});
