import type { Signals } from "@/lib/ai/signals";
import { classifyComplexityLLM, scoreComplexity } from "@/lib/ai/complexity";

export type AssistantMode = "live" | "fallback";
export type ModelRole = "default" | "scholarly";

export type RecommendedUpgrade = {
  modelRole: "scholarly";
  model: string;
  reason: string;
};

export type RouterSource = "llm" | "score" | "score-fallback" | "manual" | "none";

export type RoutingDecision = {
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  deep: boolean;
  routerSource: RouterSource;
  complexityScore?: number;
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

const CONFIRM_UPGRADE_REASON =
  "This question looks like it needs deeper, cross-text synthesis; confirm before using the scholarly model.";

export function recommendScholarlyUpgrade(prompt: string, signals?: Signals): RecommendedUpgrade | undefined {
  if (!scoreComplexity(prompt, signals).complex) return undefined;
  return { modelRole: "scholarly", model: getModelForRole("scholarly"), reason: CONFIRM_UPGRADE_REASON };
}

export async function routeAssistantPrompt(
  prompt: string,
  options: { escalate?: boolean; confirmEscalation?: boolean; signals?: Signals; live?: boolean } = {}
): Promise<RoutingDecision> {
  const { escalate = false, confirmEscalation = false, signals, live = false } = options;

  // Manual escalation is always honoured — the user has explicitly confirmed it.
  // Deep retrieval is explicit here, not implied: scholarly always retrieves deep.
  if (escalate) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      deep: true,
      routerSource: "manual",
      routingDecision: "Escalated to the scholarly model at the user's request."
    };
  }

  // Judge complexity: LLM in live mode (fast-or-fallback), pure score otherwise.
  // The score fallback is deliberately stricter than the old OR-gate (solo weak
  // cues no longer escalate) — see the spec's accepted-degraded-mode note.
  let complex: boolean;
  let routerSource: RouterSource;
  let complexityScore: number | undefined;
  let llmReason: string | undefined;
  if (live) {
    try {
      const verdict = await classifyComplexityLLM(prompt, signals);
      complex = verdict.complex;
      llmReason = verdict.reason;
      routerSource = "llm";
    } catch {
      const scored = scoreComplexity(prompt, signals);
      complex = scored.complex;
      complexityScore = scored.score;
      routerSource = "score-fallback";
    }
  } else {
    const scored = scoreComplexity(prompt, signals);
    complex = scored.complex;
    complexityScore = scored.score;
    routerSource = "score";
  }

  // Decision-source phrase, reused across ALL branches so the persisted/displayed
  // routingDecision string always names WHO decided (llm / score / fallback) — the
  // spec requires the source be visible, not just the outcome.
  const sourceLabel =
    routerSource === "llm"
      ? `the LLM router${llmReason ? ` (${llmReason})` : ""}`
      : routerSource === "score-fallback"
        ? "the deterministic score (LLM router unavailable)"
        : "the deterministic score";

  if (complex && !confirmEscalation) {
    return {
      modelRole: "scholarly",
      modelUsed: getModelForRole("scholarly"),
      deep: true,
      routerSource,
      complexityScore,
      routingDecision: `Scholarly model used automatically: ${sourceLabel} judged this question complex; deep retrieval enabled.`
    };
  }

  const recommendedUpgrade = complex
    ? { modelRole: "scholarly" as const, model: getModelForRole("scholarly"), reason: CONFIRM_UPGRADE_REASON }
    : undefined;

  return {
    modelRole: "default",
    modelUsed: getModelForRole("default"),
    deep: false,
    routerSource,
    complexityScore,
    routingDecision: recommendedUpgrade
      ? `Handled by the default model; ${sourceLabel} judged this question complex, so scholarly mode is offered on confirmation.`
      : `Handled by the default model; ${sourceLabel} judged this question routine.`,
    recommendedUpgrade
  };
}
