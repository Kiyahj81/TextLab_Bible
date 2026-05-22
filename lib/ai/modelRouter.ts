import { aiSystemPrompt } from "@/lib/ai/systemPrompt";
import type { AssistantAnswer } from "@/lib/ai/assistant";
import { getOpenAi } from "@/lib/ai/openaiClient";
import { formatToolTrace } from "@/lib/ai/toolTrace";

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

const ASSISTANT_INSTRUCTIONS = [
  aiSystemPrompt,
  "Use only the retrieved evidence and deterministic draft supplied by TextLab Bible.",
  "Preserve the three sections: Textual observations, Interpretive suggestion, and Application/reflection.",
  "Do not add lexical, manuscript, historical, or scholarly claims that are not present in the retrieved evidence."
].join("\n\n");

export function getModelForRole(role: ModelRole) {
  if (role === "scholarly") {
    return process.env.OPENAI_SCHOLARLY_MODEL?.trim() || SCHOLARLY_MODEL;
  }

  return process.env.OPENAI_DEFAULT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function isLiveAssistantEnabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.TEXTLAB_ASSISTANT_DISABLE_LIVE !== "1";
}

export function routeAssistantPrompt(prompt: string): RoutingDecision {
  const defaultModel = getModelForRole("default");
  const recommendedUpgrade = recommendScholarlyUpgrade(prompt);

  return {
    modelRole: "default",
    modelUsed: defaultModel,
    routingDecision: recommendedUpgrade
      ? "Handled by the default model for Milestone 2.5; scholarly mode is advisory until user-confirmed escalation is implemented."
      : "Handled by the default model for normal retrieval planning and synthesis.",
    recommendedUpgrade
  };
}

function buildUserPayload(prompt: string, localAnswer: AssistantAnswer) {
  return [
    `User prompt:\n${prompt}`,
    `Retrieved citations:\n${JSON.stringify(localAnswer.citations.slice(0, 20))}`,
    `Retrieval trace:\n${localAnswer.toolTrace.map(formatToolTrace).join("\n")}`,
    `Deterministic draft:\n${localAnswer.answer}`
  ].join("\n\n");
}

export async function synthesizeWithDefaultModel(input: {
  prompt: string;
  localAnswer: AssistantAnswer;
  routing: RoutingDecision;
}) {
  const client = getOpenAi();
  if (!client) return null;

  const response = await client.responses.create({
    model: input.routing.modelUsed,
    instructions: ASSISTANT_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildUserPayload(input.prompt, input.localAnswer) }
        ]
      }
    ]
  });

  return response.output_text?.trim() || null;
}

function recommendScholarlyUpgrade(prompt: string): RecommendedUpgrade | undefined {
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
    reason: "This prompt appears to ask for deeper scholarly synthesis; a later milestone should ask for confirmation before using the scholarly model."
  };
}
