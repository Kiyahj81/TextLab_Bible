// tests/unit/components/ReaderMasthead.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReaderMasthead } from "@/components/ReaderMasthead";

describe("ReaderMasthead", () => {
  it("shows the book name and chapter as the single page heading", () => {
    const { getByRole } = render(<ReaderMasthead bookLabel="John" chapter={1} />);
    const h1 = getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("John");
    expect(h1.textContent).toContain("1");
  });
});
