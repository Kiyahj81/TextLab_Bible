// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AiAssistant } from "@/components/AiAssistant";

const withheldResponse = {
  answer: "Insufficient textual evidence. ...verified evidence...",
  markdown: "# x",
  citations: [],
  toolTrace: [],
  mode: "live",
  grounded: false,
  sessionId: "s1",
  modelRole: "default",
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: "..."
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => withheldResponse }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiAssistant grounding refusal", () => {
  it("shows the withheld banner when grounded is false", async () => {
    render(<AiAssistant initialNotes={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), {
      target: { value: "bad question" }
    });
    fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));

    await screen.findByText(/withheld/i);
    expect(screen.getByText(/insufficient evidence/i)).toBeTruthy();
  });
});
