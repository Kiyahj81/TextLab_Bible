// eval/runner.ts
import { extractSignals } from "@/lib/ai/signals";
import { runRetrievalPlan, type EvidencePacket } from "@/lib/ai/retrievalPlanner";
import { verifyGrounding } from "@/lib/ai/grounding";
import { synthesizeWithRefinement } from "@/lib/ai/synthesis";
import { isLiveAssistantEnabled, routeAssistantPrompt, type RoutingDecision } from "@/lib/ai/modelRouter";
import { contextPrecision, contextRecall } from "@/eval/metrics";
import { canonicalizeReference } from "@/eval/references";
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
  rerankStatus: string | null;      // from the FIRST searchSemantic tool-trace entry, if any (back-compat)
  rerankCandidateCount: number | null;
  modelRole: string;
  routerSource: string;
  deep: boolean;
  complexityScore: number | null;
  semanticPasses: SemanticPassTrace[];
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

// The retrieved CONTEXT the synthesizer actually sees = the citation sample PLUS
// every reference in the assembled evidence text. Citations are a bounded display
// sample (≤10 per search), but formattedEvidence carries the full retrieved
// passages/results — context recall must measure the latter, or a passage longer
// than the citation cap (e.g. a 12-verse cross-chapter range) is under-counted.
// Anchored to the two evidence line formats so verse text can't yield false refs:
//   "- <ref>, SBLGNT: ..."  (passage / keyword / semantic-window lines)
//   "| <ref> | <surface> | ..."  (lemma / domain / morphology table rows)
const PASSAGE_LINE_RE = /^- (.+?), (?:SBLGNT|WEB):/gm;
const TABLE_LINE_RE = /^\| ([^|]+?) \|/gm;

function uniqueReferences(evidence: EvidencePacket): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (ref: string | null) => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    out.push(ref);
  };
  for (const c of evidence.citations) add(canonicalizeReference(c.reference) ?? c.reference);
  for (const re of [PASSAGE_LINE_RE, TABLE_LINE_RE]) {
    for (const m of evidence.formattedEvidence.matchAll(re)) add(canonicalizeReference(m[1].trim()));
  }
  return out;
}

export type SemanticPassTrace = {
  scope: string | null;          // "scoped" | "corpus-wide" from the trace label
  deep: boolean;
  rerankStatus: string | null;
  rerankCandidateCount: number | null;
};

// Pull the rerank status/candidate count/scope for EVERY searchSemantic tool-trace
// entry (Finding 5: per-hit RRF source / rank position are not exposed; these trace
// fields are). Deep mode runs TWO semantic passes (scoped + corpus-wide) — a .find()
// here would silently keep only the first and discard both scope labels, so this
// returns the full per-pass array instead.
function semanticPassesFrom(evidence: EvidencePacket): SemanticPassTrace[] {
  return evidence.toolTrace
    .filter((t) => t.tool === "searchSemantic")
    .map((t) => {
      // ToolTraceEntry.args is Record<string, unknown> | undefined. Cast through
      // unknown to narrow to the specific shape we expect from the trace fields.
      const args = t.args as unknown as
        | { scope?: string; deep?: boolean; rerankStatus?: string; rerankCandidateCount?: number }
        | undefined;
      return {
        scope: args?.scope ?? null,
        deep: args?.deep ?? false,
        rerankStatus: args?.rerankStatus ?? null,
        rerankCandidateCount: typeof args?.rerankCandidateCount === "number" ? args.rerankCandidateCount : null
      };
    });
}

// Core: route THEN retrieve, mirroring production order (answerBibleQuestion routes
// before calling runRetrievalPlan) — deep mode changes the retrieval plan itself
// (a second, corpus-wide semantic pass), so routing after retrieval would never
// exercise that path. All metrics are derived from the resulting evidence. Returns
// the packet and routing decision too so the judged path can synthesize from the
// same evidence without re-deriving either.
async function runOnce(
  item: GoldenItem,
  semanticEnabled: boolean
): Promise<{ result: RunResult; evidence: EvidencePacket; routing: RoutingDecision }> {
  const signals = extractSignals(item.question);
  // Gate mode is key-free by contract: semanticEnabled=false forces live=false so
  // only the pure deterministic score runs (no classifier egress). Report mode
  // uses the real router when a key is configured.
  const live = semanticEnabled && isLiveAssistantEnabled();
  const routing = await routeAssistantPrompt(item.question, { signals, live });
  const evidence = await runRetrievalPlan(signals, item.question, { semanticEnabled, deep: routing.deep });
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
  const semanticPasses = semanticPassesFrom(evidence);
  const firstPass = semanticPasses[0] ?? null;

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
    rerankStatus: firstPass?.rerankStatus ?? null,
    rerankCandidateCount: firstPass?.rerankCandidateCount ?? null,
    modelRole: routing.modelRole,
    routerSource: routing.routerSource,
    deep: routing.deep,
    complexityScore: routing.complexityScore ?? null,
    semanticPasses,
    synthesisStatus: "not-run",
    synthesisModel: null,
    judgeStatus: "not-run",
    judgeModel: null,
    faithfulness: null
  };
  return { result, evidence, routing };
}

// GATE mode: deterministic, DB-only (semanticEnabled=false → live stays false, so
// routing runs the pure score with no classifier egress, and retrieval sees no
// embedding/rerank calls either). Synthesis/judge are "not-run".
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
  const { result, evidence, routing } = await runOnce(item, true);

  // --- Synthesis (OPENAI_API_KEY) ---
  let synthesisStatus: SynthesisStatus;
  let synthesisModel: string | null = null;
  let answer: string | undefined;
  let synthesisError: string | undefined;
  if (!process.env.OPENAI_API_KEY) {
    synthesisStatus = "skipped-no-key";
  } else {
    try {
      // Routing already ran INSIDE runOnce, before retrieval (mirroring the
      // production order) — reuse that decision rather than re-invoking the
      // router, which would re-hit the live classifier a second time in report
      // mode. RoutingDecision doesn't carry `intent`, so it is re-derived locally
      // here; extractSignals is pure/sync (no egress), so recomputing it is cheap.
      synthesisModel = routing.modelUsed;
      const { intent } = extractSignals(item.question);
      const synth = await synthesizeWithRefinement({ prompt: item.question, evidence, routing, intent });
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
