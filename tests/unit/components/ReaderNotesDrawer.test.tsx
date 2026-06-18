// tests/unit/components/ReaderNotesDrawer.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ReaderNotesDrawer } from "@/components/ReaderNotesDrawer";

const items = [
  { id: "n1", title: null, body: "verse note", tags: ["verse"], reference: "John 1:1", verse: 1 },
  { id: "n2", title: null, body: "word note", tags: ["word"], reference: "John 1:1 · λόγος", verse: 1 }
];

afterEach(cleanup);

describe("ReaderNotesDrawer", () => {
  it("opens to reveal passage notes and jumps to a verse", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.body.innerHTML = '<div id="verse-1"></div>';
    const { getByRole, getByText } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(getByText("verse note")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /go to john 1:1 · λόγος/i }));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("renders nothing when the passage has no notes", () => {
    const { queryByRole } = render(<ReaderNotesDrawer items={[]} onChanged={() => {}} />);
    expect(queryByRole("button", { name: /notes/i })).toBeNull();
  });
});
