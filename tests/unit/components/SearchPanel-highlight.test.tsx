// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KeywordHighlight } from "@/components/SearchPanel";

afterEach(() => {
  cleanup();
});

describe("KeywordHighlight", () => {
  it("renders match segments as <mark> when highlightSegments is present", () => {
    render(
      <KeywordHighlight
        segments={[
          { kind: "text", value: "God so " },
          { kind: "match", value: "loved" },
          { kind: "text", value: " the world" }
        ]}
        text="God so loved the world"
        query="love"
      />
    );
    const mark = screen.getByText("loved");
    expect(mark.tagName).toBe("MARK");
  });

  it("falls back to literal-substring highlighting when segments are absent", () => {
    render(<KeywordHighlight text="God so loved the world" query="love" />);
    // "love" is a substring of "loved" → the fallback marks it.
    const mark = screen.getByText("love");
    expect(mark.tagName).toBe("MARK");
  });
});
