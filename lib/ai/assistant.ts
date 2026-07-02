import { createMarkdownExport } from "@/lib/export/markdown";
import {
  type AssistantMode,
  type ModelRole,
  type RecommendedUpgrade,
  type RouterSource,
  type RoutingDecision,
  isLiveAssistantEnabled,
  routeAssistantPrompt
} from "@/lib/ai/modelRouter";
import { detectBookFromPrompt, extractSignals } from "@/lib/ai/signals";
import type { AssistantCitation } from "@/lib/ai/contracts";
export type { AssistantCitation } from "@/lib/ai/contracts";
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
  deep: boolean;
  routerSource: RouterSource;
  complexityScore?: number;
};

export async function answerBibleQuestion(
  prompt: string,
  // `autoEscalate?` is accepted but ignored here for ONE task only: it keeps the
  // current route call (`answerBibleQuestion(prompt, { escalate, autoEscalate })`)
  // and its route-suite assertions compiling+passing until Task 7 migrates the
  // API to confirmEscalation. Task 7 removes `autoEscalate?` from this signature.
  options: { escalate?: boolean; confirmEscalation?: boolean; autoEscalate?: boolean } = {}
): Promise<AssistantAnswer> {
  const signals = extractSignals(prompt);
  const live = isLiveAssistantEnabled();

  if (!live) {
    // No model call happens when live synthesis is disabled — no routing runs
    // either. Report honest metadata (routerSource "none") and retrieve at
    // standard depth with semantic search off (no embedding egress/spend).
    const evidence = await runRetrievalPlan(signals, prompt, { semanticEnabled: false });
    return fallbackAnswer(prompt, evidence, {
      modelRole: "default",
      modelUsed: "none",
      deep: false,
      routerSource: "none",
      routingDecision:
        "Live synthesis is disabled, so TextLab returned the deterministic local retrieval fallback (no model call was made)."
    });
  }

  // Route FIRST so scholarly routing can widen retrieval (deep mode) — the
  // whole point of the reorder; see the design spec.
  const routing = await routeAssistantPrompt(prompt, {
    escalate: options.escalate ?? false,
    confirmEscalation: options.confirmEscalation ?? false,
    signals,
    live: true
  });
  const evidence = await runRetrievalPlan(signals, prompt, { semanticEnabled: true, deep: routing.deep });

  try {
    const result = await synthesizeWithRefinement({ prompt, evidence, routing, intent: signals.intent });
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
  deep: boolean;
  routerSource: RouterSource;
  complexityScore?: number;
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
