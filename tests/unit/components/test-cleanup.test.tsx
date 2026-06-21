// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignInForm } from "@/components/SignInForm";

// Regression guard for the shared test setup (vitest.setup.ts).
//
// Neither test calls cleanup() itself. If the global afterEach(cleanup) in the
// setup file is missing or stops working, the first render leaks into the
// second test and the second `screen.getByRole` throws "found multiple
// elements with the role". Two renders of the same component, each expecting
// exactly one match, prove the DOM is reset between tests.
describe("global DOM cleanup between component tests", () => {
  function renderForm() {
    render(<SignInForm action={vi.fn(async () => null)} callbackUrl="/read" />);
  }

  it("first render shows exactly one sign-in button", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("second render still shows exactly one (previous render was cleaned up)", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });
});
