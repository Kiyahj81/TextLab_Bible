// eval/runner.ts
import { extractSignals } from "@/lib/ai/signals";
import { runRetrievalPlan, type EvidencePacket } from "@/lib/ai/retrievalPlanner";
import { verifyGrounding } from "@/lib/ai/grounding";
import { synthesizeWithRefinement } from "@/lib/ai/synthesis";
import { routeAssistantPrompt } from "@/lib/ai/modelRouter";
import { contextPrecision, contextRecall } from "@/eval/metrics";
import { judgeFaithfulness, type FaithfulnessResult } from "@/eval/judge";
import type { GoldenItem } from "@/eval/dataset/schema";

export type RetrievedHit = { reference: string; corpus: string; toolName?: string };

export type SynthesisStatus = "ran" | "skipped-no-key" | "error" | "not-run"; // not-run = deterministic mode
export type JudgeStatus = "ran" | "skipped-no-key" | "skipped-no-answer" | "error" | "not-run";

export type RunResult = {
  item: GoldenItem;
  mode: "deterministic" | "hybrid";
  retrievedReferences: string[];
  hits: RetrievedHit[];
  recall: number;
  precision: number;
  citationsResolve: boolean;        // every emitted citation resolves to a real verse
  lemmaRequired: boolean;
  lemmaFound: boolean;
  rerankStatus: string | null;      // from the searchSemantic tool-trace entry, if any
  rerankCandidateCount: number | null;
  // Explicit, separate statuses (Finding 3) — never inferred from output presence:
  synthesisStatus: SynthesisStatus;
  synthesisModel: string | null;
  synthesisError?: string;
  judgeStatus: JudgeStatus;
  judgeModel: string | null;
  judgeError?: string;
  faithfulness: FaithfulnessResult | null;
  answer?: string;                  // present only when synthesis ran
};

function uniqueReferences(evidence: EvidencePacket): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of evidence.citations) {
    if (seen.has(c.reference)) continue;
    seen.add(c.reference);
    out.push(c.reference);
  }
  return out;
}

// Pull the rerank status/candidate count the semantic call recorded in the tool trace
// (Finding 5: per-hit RRF source / rank position are not exposed; these trace fields are).
function semanticTraceFrom(evidence: EvidencePacket): { rerankStatus: string | null; rerankCandidateCount: number | null } {
  const entry = evidence.toolTrace.find((t) => t.tool === "searchSemantic");
  // ToolTraceEntry.args is Record<string, unknown> | undefined. Cast through unknown
  // to narrow to the specific shape we expect from the rerank trace fields.
  const args = entry?.args as unknown as { rerankStatus?: string; rerankCandidateCount?: number } | undefined;
  return {
    rerankStatus: args?.rerankStatus ?? null,
    rerankCandidateCount: typeof args?.rerankCandidateCount === "number" ? args.rerankCandidateCount : null
  };
}

// Core: ONE retrieval, all metrics derived from it. Returns the packet too so the
// judged path can synthesize from the same evidence.
async function runOnce(
  item: GoldenItem,
  semanticEnabled: boolean
): Promise<{ result: RunResult; evidence: EvidencePacket }> {
  const signals = extractSignals(item.question);
  const evidence = await runRetrievalPlan(signals, item.question, semanticEnabled);
  const retrieved = uniqueReferences(evidence);

  const claims = evidence.citations.map((c) => ({
    reference: c.reference,
    greekQuote: null,
    gloss: null,
    englishQuote: null
  }));
  const report = await verifyGrounding(claims);

  const lemmaRequired = Boolean(item.mustContainLemma);
  const lemmaFound = lemmaRequired
    ? evidence.formattedEvidence.includes(item.mustContainLemma as string)
    : false;
  const semanticTrace = semanticTraceFrom(evidence);

  const result: RunResult = {
    item,
    mode: semanticEnabled ? "hybrid" : "deterministic",
    retrievedReferences: retrieved,
    hits: evidence.citations.map((c) => ({ reference: c.reference, corpus: c.corpus, toolName: c.toolName })),
    recall: contextRecall(retrieved, item.goldenReferences),
    precision: contextPrecision(retrieved, item.goldenReferences),
    citationsResolve: report.grounded,
    lemmaRequired,
    lemmaFound,
    rerankStatus: semanticTrace.rerankStatus,
    rerankCandidateCount: semanticTrace.rerankCandidateCount,
    synthesisStatus: "not-run",
    synthesisModel: null,
    judgeStatus: "not-run",
    judgeModel: null,
    faithfulness: null
  };
  return { result, evidence };
}

// GATE mode: deterministic, DB-only (semanticEnabled=false → no embedding egress,
// no rerank, key-free, reproducible). Synthesis/judge are "not-run".
export async function runDeterministic(item: GoldenItem): Promise<RunResult> {
  const { result } = await runOnce(item, false);
  return result;
}

// REPORT mode: full hybrid pipeline (semanticEnabled=true). Metrics AND (when it
// runs) the judged answer derive from the SAME packet. Dual-key by design:
// synthesis needs OPENAI_API_KEY; the judge needs AI_GATEWAY_API_KEY. Each stage
// records an EXPLICIT status (Finding 3) — a missing key, wrong model slug,
// timeout, or provider error is labeled, never inferred from output presence.
export async function runWithJudge(item: GoldenItem): Promise<RunResult> {
  const { result, evidence } = await runOnce(item, true);

  // --- Synthesis (OPENAI_API_KEY) ---
  let synthesisStatus: SynthesisStatus;
  let synthesisModel: string | null = null;
  let answer: string | undefined;
  let synthesisError: string | undefined;
  if (!process.env.OPENAI_API_KEY) {
    synthesisStatus = "skipped-no-key";
  } else {
    try {
      const routing = routeAssistantPrompt(item.question, false);
      synthesisModel = routing.modelUsed;
      const synth = await synthesizeWithRefinement({ prompt: item.question, evidence, routing });
      if (synth) {
        answer = synth.answer;
        synthesisStatus = "ran";
      } else {
        // Key present but synthesis returned null (parse failure / no client).
        synthesisStatus = "error";
        synthesisError = "synthesis returned no result";
      }
    } catch (err) {
      synthesisStatus = "error";
      synthesisError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }
  }

  // --- Judge (AI_GATEWAY_API_KEY) — only meaningful with an answer ---
  let judgeStatus: JudgeStatus;
  let judgeModel: string | null = null;
  let judgeError: string | undefined;
  let faithfulness: FaithfulnessResult | null = null;
  if (answer === undefined) {
    judgeStatus = "skipped-no-answer";
  } else {
    const outcome = await judgeFaithfulness(answer, evidence);
    judgeStatus = outcome.status === "ran" ? "ran" : outcome.status === "skipped-no-key" ? "skipped-no-key" : "error";
    if (outcome.status === "ran") {
      faithfulness = outcome.result;
      judgeModel = outcome.result.model;
    } else if (outcome.status === "error") {
      judgeModel = outcome.model;
      judgeError = outcome.message;
    }
  }

  return { ...result, synthesisStatus, synthesisModel, synthesisError, answer, judgeStatus, judgeModel, judgeError, faithfulness };
}
