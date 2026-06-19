// tests/unit/components/ReaderNotesDrawer.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { ReaderNotesDrawer } from "@/components/ReaderNotesDrawer";

const rectAt = (left: number) =>
  ({ left, width: 80, right: left + 80, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

const items = [
  { id: "n1", title: null, body: "verse note", tags: ["verse"], reference: "John 1:1", verse: 1 },
  { id: "n2", title: null, body: "word note", tags: ["word"], reference: "John 1:1 · λόγος", verse: 1 }
];

const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  document.body.innerHTML = "";
});

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

  it("closes on Escape", () => {
    const { getByRole, queryByText } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(queryByText("verse note")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByText("verse note")).toBeNull();
  });

  it("closes on an outside click", () => {
    const { getByRole, queryByText } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(queryByText("verse note")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(queryByText("verse note")).toBeNull();
  });

  it("jumps from the verse-reference group too", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.body.innerHTML = '<div id="verse-1"></div>';
    const { getByRole } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    fireEvent.click(getByRole("button", { name: /^go to john 1:1$/i }));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("closes and does not reopen after the last note is deleted, then re-added", () => {
    const { getByRole, queryByText, rerender } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(queryByText("verse note")).toBeTruthy(); // open

    rerender(<ReaderNotesDrawer items={[]} onChanged={() => {}} />); // last note deleted → hidden
    expect(queryByText("verse note")).toBeNull();

    rerender(<ReaderNotesDrawer items={items} onChanged={() => {}} />); // notes return (e.g. refresh)
    expect(queryByText("verse note")).toBeNull(); // stays CLOSED — open was reset

    fireEvent.click(getByRole("button", { name: /notes \(2\)/i })); // re-opening still works
    expect(queryByText("verse note")).toBeTruthy();
  });

  it("recomputes alignment on viewport resize while open", () => {
    // Trigger in the right half of the (default 1024px) viewport → right-anchored.
    Element.prototype.getBoundingClientRect = vi.fn(() => rectAt(900));
    const { getByRole, container } = render(<ReaderNotesDrawer items={items} onChanged={() => {}} />);
    fireEvent.click(getByRole("button", { name: /notes \(2\)/i }));
    expect(container.querySelector(".right-0")).toBeTruthy();
    expect(container.querySelector(".left-0")).toBeNull();

    // Viewport narrows / controls reflow left → trigger now in the left half.
    Element.prototype.getBoundingClientRect = vi.fn(() => rectAt(10));
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(container.querySelector(".left-0")).toBeTruthy();
    expect(container.querySelector(".right-0")).toBeNull();
  });
});
