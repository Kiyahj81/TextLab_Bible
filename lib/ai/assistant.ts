import { createMarkdownExport } from "@/lib/export/markdown";
import {
  type AssistantMode,
  type ModelRole,
  type RecommendedUpgrade,
  type RoutingDecision,
  isLiveAssistantEnabled,
  routeAssistantPrompt
} from "@/lib/ai/modelRouter";
import { detectBookFromPrompt, extractSignals } from "@/lib/ai/signals";
import { type EvidencePacket, runRetrievalPlan } from "@/lib/ai/retrievalPlanner";
import {
  appendAlignmentNotes,
  buildDeterministicFallback,
  buildRefusalAnswer,
  synthesizeWithRefinement
} from "@/lib/ai/synthesis";
import { verifyGrounding, type GroundingReport } from "@/lib/ai/grounding";
import { type ToolTraceEntry } from "@/lib/ai/toolTrace";

export { detectBookFromPrompt };

export type AssistantCitation = {
  reference: string;
  corpus: string;
  searchQuery: string;
  toolName?: string;
  book?: string;
  chapter?: number;
  verse?: number;
  tokenId?: string;
};

export type AssistantAnswer = {
  answer: string;
  citations: AssistantCitation[];
  markdown: string;
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  grounded: boolean;
  groundingReport?: GroundingReport;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
  sessionId?: string;
};

export async function answerBibleQuestion(
  prompt: string,
  options: { escalate?: boolean } = {}
): Promise<AssistantAnswer> {
  const routing = routeAssistantPrompt(prompt, options.escalate ?? false);
  const signals = extractSignals(prompt);
  const evidence = await runRetrievalPlan(signals, prompt);

  if (!isLiveAssistantEnabled()) {
    return fallbackAnswer(prompt, evidence, routing);
  }

  try {
    const result = await synthesizeWithRefinement({ prompt, evidence, routing });
    if (!result) {
      return fallbackAnswer(prompt, evidence, routing);
    }

    let report: GroundingReport;
    try {
      report = await verifyGrounding(result.claims);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "Unknown error";
      return withMarkdown({
        title: "TextLab Assistant",
        answer: buildDeterministicFallback(prompt, evidence),
        citations: evidence.citations,
        toolTrace: [...result.toolTrace, { tool: "grounding", error: message }],
        mode: "fallback",
        grounded: true,
        ...routing,
        routingDecision: `${routing.routingDecision} Grounding verification could not run, so TextLab returned the local retrieval fallback.`
      });
    }

    if (!report.grounded) {
      const failed = report.verdicts.filter((v) => v.status !== "verified").length;
      return withMarkdown({
        title: "TextLab Assistant",
        answer: buildRefusalAnswer(prompt, evidence, report),
        citations: evidence.citations,
        toolTrace: [
          ...result.toolTrace,
          { tool: "grounding", args: { grounded: false, failedClaims: failed } },
          { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } }
        ],
        mode: "live",
        grounded: false,
        groundingReport: report,
        ...routing
      });
    }

    return withMarkdown({
      title: "TextLab Assistant",
      answer: appendAlignmentNotes(result.answer, report),
      citations: result.citations,
      toolTrace: [
        ...result.toolTrace,
        { tool: "grounding", args: { grounded: true } },
        { tool: "modelRouter", args: { role: routing.modelRole, model: routing.modelUsed } }
      ],
      mode: "live",
      grounded: true,
      groundingReport: report,
      ...routing
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return withMarkdown({
      title: "TextLab Assistant",
      answer: buildDeterministicFallback(prompt, evidence),
      citations: evidence.citations,
      toolTrace: [...evidence.toolTrace, { tool: "openai.responses.create", error: message }],
      mode: "fallback",
      grounded: true,
      ...routing,
      routingDecision: `${routing.routingDecision} The live model call failed, so TextLab returned the local retrieval fallback.`
    });
  }
}

function fallbackAnswer(prompt: string, evidence: EvidencePacket, routing: RoutingDecision): AssistantAnswer {
  return withMarkdown({
    title: "TextLab Assistant",
    answer: buildDeterministicFallback(prompt, evidence),
    citations: evidence.citations,
    toolTrace: evidence.toolTrace,
    mode: "fallback",
    grounded: true,
    ...routing
  });
}

type WithMarkdownInput = {
  title: string;
  answer: string;
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
  mode: AssistantMode;
  grounded: boolean;
  groundingReport?: GroundingReport;
  modelRole: ModelRole;
  modelUsed: string;
  routingDecision: string;
  recommendedUpgrade?: RecommendedUpgrade;
};

function withMarkdown(input: WithMarkdownInput): AssistantAnswer {
  const { title, answer, citations, toolTrace, ...metadata } = input;
  const exportResult = createMarkdownExport({
    title,
    body: answer,
    citations
  });

  return {
    answer,
    citations,
    markdown: exportResult.markdown,
    toolTrace,
    ...metadata
  };
}
