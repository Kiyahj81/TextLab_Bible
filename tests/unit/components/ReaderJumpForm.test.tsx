// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ReaderJumpForm } from "@/components/ReaderJumpForm";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("ReaderJumpForm", () => {
  afterEach(() => { cleanup(); push.mockReset(); });

  it("navigates to a typed reference (with verse) on submit", () => {
    const { getByRole } = render(<ReaderJumpForm />);
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "John 3:16" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/read?book=John&chapter=3&verse=16");
  });

  it("navigates to a chapter-only reference (no verse) on submit", () => {
    const { getByRole } = render(<ReaderJumpForm />);
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "Romans 8" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(push).toHaveBeenCalledWith("/read?book=Rom&chapter=8");
  });

  it("shows an error for an unparseable reference and does not navigate", () => {
    const { getByRole, getByText } = render(<ReaderJumpForm />);
    fireEvent.change(getByRole("textbox", { name: /reference/i }), { target: { value: "nope" } });
    fireEvent.submit(getByRole("textbox", { name: /reference/i }).closest("form")!);
    expect(getByText(/try a reference like/i)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
