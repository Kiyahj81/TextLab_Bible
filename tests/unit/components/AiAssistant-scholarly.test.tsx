// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AiAssistant } from "@/components/AiAssistant";

const defaultResponse = {
  answer: "default answer",
  markdown: "# x",
  citations: [],
  toolTrace: [],
  mode: "live",
  sessionId: "s1",
  modelRole: "default",
  modelUsed: "gpt-5.3-chat-latest",
  routingDecision: "Handled by the default model; scholarly mode is available on user-confirmed escalation.",
  recommendedUpgrade: { modelRole: "scholarly", model: "gpt-5.4", reason: "deeper synthesis" }
};

const scholarlyResponse = {
  ...defaultResponse,
  answer: "scholarly answer",
  modelRole: "scholarly",
  modelUsed: "gpt-5.4",
  recommendedUpgrade: undefined,
  routingDecision: "Escalated to the scholarly model at the user's request."
};

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => defaultResponse })
    .mockResolvedValueOnce({ ok: true, json: async () => scholarlyResponse });
  vi.stubGlobal("fetch", mock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiAssistant scholarly escalation", () => {
  it("offers escalation when recommended and re-submits with escalate:true", async () => {
    render(<AiAssistant initialNotes={[]} />);

    fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), {
      target: { value: "deep synthesis" }
    });
    fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));

    const escalateButton = await screen.findByRole("button", { name: /use scholarly model/i });
    fireEvent.click(escalateButton);

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(2));

    const secondBody = JSON.parse(fetchMock().mock.calls[1][1].body as string);
    expect(secondBody.escalate).toBe(true);
    expect(secondBody.prompt).toBe("deep synthesis");

    await screen.findByText("scholarly answer");
    // Once escalated, the offer is gone.
    expect(screen.queryByRole("button", { name: /use scholarly model/i })).toBeNull();
  });

  it("does not offer escalation when no upgrade is recommended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...defaultResponse, recommendedUpgrade: undefined })
      })
    );

    render(<AiAssistant initialNotes={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), {
      target: { value: "simple question" }
    });
    fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));

    await screen.findByText("default answer");
    expect(screen.queryByRole("button", { name: /use scholarly model/i })).toBeNull();
  });
});
