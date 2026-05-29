export type AssistantMode = "live" | "fallback";
export type ModelRole = "default" | "scholarly";

export type RecommendedUpgrade = {
  modelRole: "scholarly";
  model: string;
  reason: string;
};

export type RoutingDecision = {
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};

const DEFAULT_MODEL = "gpt-5.3-chat-latest";
const SCHOLARLY_MODEL = "gpt-5.4";

const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;

export function getMaxOutputTokens(): number {
  const raw = Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS?.trim() ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

export function getModelForRole(role: ModelRole) {
  if (role === "scholarly") {
    return process.env.OPENAI_SCHOLARLY_MODEL?.trim() || SCHOLARLY_MODEL;
  }

  return process.env.OPENAI_DEFAULT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function isLiveAssistantEnabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.TEXTLAB_ASSISTANT_DISABLE_LIVE !== "1";
}

export function routeAssistantPrompt(prompt: string, escalate = false): RoutingDecision {
  // Escalation is always user-confirmed — the router never selects the scholarly
  // model on its own; it only advises it via recommendedUpgrade.
  if (escalate) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      routingDecision: "Escalated to the scholarly model at the user's request."
    };
  }

  const recommendedUpgrade = recommendScholarlyUpgrade(prompt);

  return {
    modelRole: "default",
    modelUsed: getModelForRole("default"),
    routingDecision: recommendedUpgrade
      ? "Handled by the default model; scholarly mode is available on user-confirmed escalation."
      : "Handled by the default model for normal retrieval planning and synthesis.",
    recommendedUpgrade
  };
}

export function recommendScholarlyUpgrade(prompt: string): RecommendedUpgrade | undefined {
  const normalized = prompt.toLowerCase();
  const scholarlySignals = [
    "scholarly",
    "theological nuance",
    "cross-text",
    "cross text",
    "ambiguity",
    "ambiguous",
    "long-chain",
    "large-content",
    "research quality",
    "research-quality",
    "deep synthesis",
    "complex theological",
    "interpretive options"
  ];

  if (!scholarlySignals.some((signal) => normalized.includes(signal))) {
    return undefined;
  }

  return {
    modelRole: "scholarly",
    model: getModelForRole("scholarly"),
    reason: "This prompt appears to ask for deeper scholarly synthesis; confirm before using the scholarly model."
  };
}
