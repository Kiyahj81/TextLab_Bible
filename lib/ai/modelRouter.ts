import { detectConceptWords, type Signals } from "@/lib/ai/signals";

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

// gpt-5-chat-latest (not gpt-5.3-chat-latest) because the synthesis calls pass a
// `temperature`, which gpt-5.3-chat-latest rejects as an invalid parameter (the
// 400 would throw and surface the local fallback). Both gpt-5-chat-latest and
// the scholarly gpt-5.4 accept temperature.
const DEFAULT_MODEL = "gpt-5-chat-latest";  // Testing different models for best answers. This may be changed.
const SCHOLARLY_MODEL = "gpt-5.4";

const DEFAULT_MAX_OUTPUT_TOKENS = 2_400;

// Lower than the model default (~1.0) to curb sampling noise — including the
// occasional foreign-language token leak in the prose. Tunable per-environment;
// 0 (fully deterministic) is valid, so the guard accepts >= 0 (unlike tokens).
const DEFAULT_TEMPERATURE = 0.3;  // Testing different temperatures for best answers. This may be changed.

export function getMaxOutputTokens(): number {
  const raw = Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS?.trim() ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

export function getTemperature(): number {
  const raw = Number.parseFloat(process.env.OPENAI_TEMPERATURE?.trim() ?? "");
  if (Number.isFinite(raw) && raw >= 0 && raw <= 2) return raw;
  return DEFAULT_TEMPERATURE;
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

export function routeAssistantPrompt(
  prompt: string,
  options: { escalate?: boolean; autoEscalate?: boolean; signals?: Signals } = {}
): RoutingDecision {
  const { escalate = false, autoEscalate = false, signals } = options;

  // Manual escalation is always honoured — the user has explicitly confirmed it.
  if (escalate) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      routingDecision: "Escalated to the scholarly model at the user's request."
    };
  }

  const recommendedUpgrade = recommendScholarlyUpgrade(prompt, signals);

  // Opt-in first-pass auto-escalation: when the user has turned on auto-scholarly
  // AND this question looks complex, go scholarly on the first pass without
  // requiring an extra round-trip confirmation.
  if (autoEscalate && recommendedUpgrade) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      routingDecision:
        "Auto-escalated to the scholarly model (auto-scholarly is on and this question looks complex)."
    };
  }

  return {
    modelRole: "default",
    modelUsed: getModelForRole("default"),
    routingDecision: recommendedUpgrade
      ? "Handled by the default model; scholarly mode is available on user-confirmed escalation."
      : "Handled by the default model for normal retrieval planning and synthesis.",
    recommendedUpgrade
  };
}

const SCHOLARLY_CUE_RE =
  /\b(scholarly|deep synthesis|theological nuance|interpretive options|reconcile|reconciliation between|tension|paradox|harmoniz|ambiguity|ambiguous)/i;
const HOW_CAN_BOTH_RE = /\bhow (can|do|does)\b[\s\S]{0,60}\band\b/i;
// "why does/do/did …" is interpretive/synthesis framing the spec calls out explicitly.
const WHY_FRAMING_RE = /\bwhy (do|does|did)\b/i;

export function recommendScholarlyUpgrade(prompt: string, signals?: Signals): RecommendedUpgrade | undefined {
  const distinctBooks = new Set((signals?.references ?? []).map((r) => r.book)).size;
  // Concept count comes from detectConceptWords (frozen base stoplist), NOT signals.topicWords
  // (search-tunable), so tuning the search stoplist can never shift scholarly routing.
  const conceptCount = detectConceptWords(prompt).length;
  const longPrompt = prompt.trim().split(/\s+/).length > 30;

  const complex =
    signals?.intent === "comparison" ||
    distinctBooks >= 2 ||
    SCHOLARLY_CUE_RE.test(prompt) ||
    HOW_CAN_BOTH_RE.test(prompt) ||
    WHY_FRAMING_RE.test(prompt) ||
    conceptCount >= 3 ||
    longPrompt;

  if (!complex) return undefined;
  return {
    modelRole: "scholarly",
    model: getModelForRole("scholarly"),
    reason: "This question looks like it needs deeper, cross-text synthesis; confirm before using the scholarly model."
  };
}
