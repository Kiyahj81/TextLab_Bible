// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SignInForm } from "@/components/SignInForm";

describe("SignInForm", () => {
  it("renders email and name inputs with the action wired", () => {
    const action = vi.fn(async () => null);
    const { getByLabelText, getByRole } = render(
      <SignInForm action={action} callbackUrl="/read" />
    );
    expect(getByLabelText(/email/i)).toBeTruthy();
    expect(getByLabelText(/display name/i)).toBeTruthy();
    expect(getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("renders a hidden callbackUrl input matching prop", () => {
    const action = vi.fn(async () => null);
    const { container } = render(<SignInForm action={action} callbackUrl="/notes" />);
    const hidden = container.querySelector('input[name="callbackUrl"]') as HTMLInputElement | null;
    expect(hidden?.value).toBe("/notes");
  });

  it("surfaces error string returned by the action via initialState prop", () => {
    const action = vi.fn(async () => "Invalid credentials.");
    const { getByText } = render(
      <SignInForm action={action} callbackUrl="/read" initialError="Invalid credentials." />
    );
    expect(getByText(/invalid credentials/i)).toBeTruthy();
  });
});
