// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ReadError from "@/app/read/error";

afterEach(cleanup);

describe("ReadError", () => {
  it("renders the passage error with a Back to John 1 link", () => {
    render(<ReadError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("heading", { name: /couldn't load this passage/i })).toBeTruthy();
    const link = screen.getByRole("link", { name: /back to john 1/i });
    expect(link.getAttribute("href")).toBe("/read?book=John&chapter=1");
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    render(<ReadError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
