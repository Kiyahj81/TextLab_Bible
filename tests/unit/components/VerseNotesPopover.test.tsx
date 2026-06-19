// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { VerseNotesPopover } from "@/components/VerseNotesPopover";

const notes = [{ id: "n1", title: "Rom 1:18", body: "Wrath of God note", tags: ["verse"] }];

afterEach(cleanup);

describe("VerseNotesPopover", () => {
  it("renders nothing when there are no notes", () => {
    const { queryByRole } = render(<VerseNotesPopover notes={[]} reference="Rom 1:18" onChanged={() => {}} />);
    expect(queryByRole("button", { name: /notes on/i })).toBeNull();
  });

  it("opens a popover with the note and closes on Escape", () => {
    const { getByRole, getByText, queryByText } = render(
      <VerseNotesPopover notes={notes} reference="Rom 1:18" onChanged={() => {}} />
    );
    fireEvent.click(getByRole("button", { name: /notes on rom 1:18/i }));
    expect(getByText("Wrath of God note")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByText("Wrath of God note")).toBeNull();
  });

  it("closes on an outside click", () => {
    const { getByRole, getByText, queryByText } = render(
      <VerseNotesPopover notes={notes} reference="Rom 1:18" onChanged={() => {}} />
    );
    fireEvent.click(getByRole("button", { name: /notes on rom 1:18/i }));
    expect(getByText("Wrath of God note")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(queryByText("Wrath of God note")).toBeNull();
  });
});
