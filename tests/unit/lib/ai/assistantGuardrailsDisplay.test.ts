import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assistantGuardrailsDisplay } from "@/lib/ai/assistantGuardrailsDisplay";

describe("assistantGuardrailsDisplay", () => {
  it("is honest UI copy rather than the live synthesis system prompt", () => {
    expect(assistantGuardrailsDisplay).toContain("Corpus-grounded answers");
    expect(assistantGuardrailsDisplay).toContain("retrieval trace");
    expect(assistantGuardrailsDisplay).not.toContain("first call the relevant search or passage tool");
    expect(assistantGuardrailsDisplay).not.toContain("Return JSON matching the provided schema");
  });

  it("is the prompt copy rendered by the assistant page", () => {
    const page = readFileSync("app/assistant/page.tsx", "utf8");

    expect(page).toContain('import { assistantGuardrailsDisplay } from "@/lib/ai/assistantGuardrailsDisplay";');
    expect(page).toContain("{assistantGuardrailsDisplay}");
    expect(page).not.toContain("@/lib/ai/systemPrompt");
    expect(page).not.toContain("{aiSystemPrompt}");
  });
});
