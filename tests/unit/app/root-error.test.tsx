// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RootError from "@/app/error";

afterEach(cleanup);

describe("RootError", () => {
  it("renders the generic error with a Home link", () => {
    render(<RootError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /home/i }).getAttribute("href")).toBe("/");
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    render(<RootError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
