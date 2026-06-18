// tests/unit/lib/focus.test.ts
import { describe, expect, it } from "vitest";
import { FOCUS_RING, FOCUS_RING_INPUT } from "@/lib/ui/focus";

describe("focus ring tokens", () => {
  it("uses focus-visible and an accent ring", () => {
    expect(FOCUS_RING).toContain("focus-visible:ring-2");
    expect(FOCUS_RING).toContain("focus-visible:ring-accent-400");
    expect(FOCUS_RING).toContain("focus:outline-none");
  });
  it("keeps a ring for inputs too", () => {
    expect(FOCUS_RING_INPUT).toContain("focus-visible:ring-2");
  });
});
