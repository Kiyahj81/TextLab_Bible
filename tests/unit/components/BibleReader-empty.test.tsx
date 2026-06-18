// tests/unit/components/BibleReader-empty.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { BibleReader } from "@/components/BibleReader";

describe("BibleReader empty state", () => {
  it("shows a reader-facing message with a way back, never implementation detail", () => {
    const { getByRole, queryByText } = render(
      <BibleReader verses={[]} initialMode="parallel" chapterLabel="John 1" />
    );
    expect(queryByText(/prisma|postgres|seed script/i)).toBeNull();
    const link = getByRole("link", { name: /john 1/i });
    expect(link.getAttribute("href")).toContain("/read?book=John&chapter=1");
  });
});
