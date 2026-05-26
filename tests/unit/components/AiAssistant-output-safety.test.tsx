// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiAssistant } from "@/components/AiAssistant";

// Belt-and-braces test against assistant prompt-injection of HTML/JS into
// the UI. React escapes text nodes by default; this guards against any
// future change that switches to raw-HTML rendering on the assistant
// response, generated-note answer, or generated-note prompt.
describe("AiAssistant output rendering safety", () => {
  const xssPayload = `<script>window.__pwned = true;</script><img src=x onerror="window.__pwned=true">`;

  it("renders saved-note prompt and answer as text, not as parsed HTML", () => {
    render(
      <AiAssistant
        initialNotes={[
          {
            id: "n1",
            prompt: xssPayload,
            answer: xssPayload,
            markdown: "ok",
            createdAt: new Date("2026-05-26T00:00:00Z").toISOString()
          }
        ]}
      />
    );

    // The literal string must appear in the DOM, proving it was rendered
    // as text content. If React had parsed it as HTML, screen.getByText
    // (which matches text nodes) would not find it.
    const matches = screen.getAllByText(xssPayload);
    expect(matches.length).toBeGreaterThan(0);

    // And no actual <script> or <img onerror> may exist anywhere in the
    // rendered tree — those would only appear if the payload had been
    // parsed.
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img[onerror]")).toBeNull();

    // And no side effect ran.
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
