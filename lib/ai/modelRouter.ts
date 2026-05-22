import { aiSystemPrompt } from "@/lib/ai/systemPrompt";
import type { AssistantAnswer } from "@/lib/ai/assistant";

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

export async function synthesizeWithDefaultModel(input: {
  prompt: string;
  localAnswer: AssistantAnswer;
  routing: RoutingDecision;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const response = await fetchResponsesWithRetry({
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.routing.modelUsed,
      instructions: [
        aiSystemPrompt,
        "Use only the retrieved evidence and deterministic draft supplied by TextLab Bible.",
        "Preserve the three sections: Textual observations, Interpretive suggestion, and Application/reflection.",
        "Do not add lexical, manuscript, historical, or scholarly claims that are not present in the retrieved evidence."
      ].join("\n\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `User prompt:\n${input.prompt}`,
                `Retrieved citations:\n${JSON.stringify(input.localAnswer.citations, null, 2)}`,
                `Retrieval trace:\n${input.localAnswer.toolTrace.join("\n")}`,
                `Deterministic draft:\n${input.localAnswer.answer}`
              ].join("\n\n")
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses API returned ${response.status}`);
  }

  const payload = (await response.json()) as OpenAiResponsePayload;
  return extractResponseText(payload);
}

function getRequestTimeoutMs() {
  const raw = process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25_000;
}

async function fetchResponsesWithRetry(init: Omit<RequestInit, "signal">) {
  const timeoutMs = getRequestTimeoutMs();

  async function attempt() {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`OpenAI request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    try {
      return await new Promise<Response>((resolve, reject) => {
        // Reject on abort so a non-compliant fetch implementation (e.g. a test stub
        // that ignores AbortSignal) still surfaces the timeout to the caller.
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason ?? new Error("OpenAI request aborted")),
          { once: true }
        );
        fetch("https://api.openai.com/v1/responses", { ...init, signal: controller.signal }).then(
          resolve,
          reject
        );
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const first = await attempt();
  if (![429, 500, 502, 503, 504].includes(first.status)) return first;

  const retryAfterMs = parseRetryAfter(first.headers.get("retry-after"), 500);
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  return attempt();
}

function parseRetryAfter(value: string | null, fallback: number) {
  if (!value) return fallback;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 10_000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 10_000));
  return fallback;
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

type OpenAiResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
};

function extractResponseText(payload: OpenAiResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();

  return text || null;
}
