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
  modelUsed: "gpt-5-chat-latest",
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

async function submitPrompt(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));
  await waitFor(() => expect(fetchMock().mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => {
  document.cookie = "textlab-assistant-confirm-scholarly=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
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

  it("offers manual escalation even when no upgrade is recommended (decoupled)", async () => {
    // Manual escalation is decoupled from recommendedUpgrade: a non-scholarly answer
    // the router judged routine (or a score-fallback that no longer recommends an
    // upgrade) can still be re-run with the scholarly model.
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
    const escalateButton = await screen.findByRole("button", { name: /use scholarly model/i });
    fireEvent.click(escalateButton);
    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(2));
    expect(JSON.parse(fetchMock().mock.calls[1][1].body as string).escalate).toBe(true);
  });

  it("hides the scholarly button on a non-live fallback (modelUsed none) — escalation can't work", async () => {
    // Live synthesis disabled → modelUsed "none"; answerBibleQuestion exits before
    // routing, so escalation is impossible. Offering the button would only re-run the
    // same fallback, so it must be hidden.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...defaultResponse,
          mode: "fallback",
          modelUsed: "none",
          recommendedUpgrade: undefined,
          routingDecision: "Live synthesis is disabled, so TextLab returned the deterministic local retrieval fallback (no model call was made)."
        })
      })
    );
    render(<AiAssistant initialNotes={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Show me every use/i), { target: { value: "simple question" } });
    fireEvent.click(screen.getByRole("button", { name: /ask assistant/i }));
    await screen.findByText("default answer");
    expect(screen.queryByRole("button", { name: /use scholarly model/i })).toBeNull();
  });

  it("expires the legacy auto-scholarly cookie on mount so the migration can be retired", () => {
    document.cookie = "textlab-assistant-auto-scholarly=1; path=/";
    document.cookie = "textlab-assistant-confirm-scholarly=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    render(<AiAssistant initialNotes={[]} />);
    expect(document.cookie).not.toContain("textlab-assistant-auto-scholarly=");
  });
});

describe("AiAssistant ask-first toggle", () => {
  it("sends confirmEscalation when the ask-first toggle is on", async () => {
    render(<AiAssistant initialNotes={[]} confirmScholarly />);
    await submitPrompt("Why does Paul describe a tension between law and grace?");
    const body = JSON.parse(fetchMock().mock.calls[0][1].body as string);
    expect(body.confirmEscalation).toBe(true);
    expect(body.autoEscalate).toBeUndefined();
  });

  it("sends neither flag when the toggle is off (auto default)", async () => {
    render(<AiAssistant initialNotes={[]} />);
    await submitPrompt("Why does Paul describe a tension between law and grace?");
    const body = JSON.parse(fetchMock().mock.calls[0][1].body as string);
    expect(body.confirmEscalation).toBeUndefined();
    expect(body.autoEscalate).toBeUndefined();
  });

  it("writes the new confirm cookie when toggled", () => {
    // Clear first: the component's migration-seed effect (added below) writes this
    // same cookie on EVERY mount whenever it's unset, including the two tests above
    // — without clearing, this assertion could pass even if the click handler did
    // nothing, because an earlier test's mount already seeded "1".
    document.cookie = "textlab-assistant-confirm-scholarly=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    render(<AiAssistant initialNotes={[]} />);
    // The migration-seed effect fires on mount with the default (unset) prop → "0".
    expect(document.cookie).toContain("textlab-assistant-confirm-scholarly=0");
    fireEvent.click(screen.getByLabelText(/ask before using the scholarly model/i));
    // Prove the CLICK, not the seed effect, drove this: "0" → "1".
    expect(document.cookie).toContain("textlab-assistant-confirm-scholarly=1");
  });
});
