// eval/judge.ts
import { generateObject } from "ai";
import { z } from "zod";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

// Bare creator/model slug routed through the AI SDK's Vercel AI Gateway global
// provider (authenticated by AI_GATEWAY_API_KEY) — same mechanism as rerank.ts.
// NOTE THE DOT: the Gateway catalog uses dotted Claude version slugs
// (`anthropic/claude-sonnet-4.6`), matching `voyage/rerank-2.5` in rerank.ts —
// NOT the hyphenated direct-API id `claude-sonnet-4-6` (that errors on the
// Gateway). VERIFY the exact slug against the current Vercel AI Gateway model
// list before first run; on a wrong slug the judge reports status "error"
// (visible in the report), it does not silently vanish.
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-4.6";
export const EVAL_JUDGE_TIMEOUT_MS =
  Number(process.env.EVAL_JUDGE_TIMEOUT_MS) > 0 ? Number(process.env.EVAL_JUDGE_TIMEOUT_MS) : 30_000;

const claimSchema = z.object({
  statement: z.string(),
  supported: z.boolean(),
  reason: z.string()
});
const faithfulnessSchema = z.object({ claims: z.array(claimSchema) });

export type FaithfulnessClaim = z.infer<typeof claimSchema>;
export type FaithfulnessResult = { score: number; claims: FaithfulnessClaim[]; model: string };

// Explicit outcome so the report can distinguish "no key" from "model/timeout/
// provider error" — never collapse every non-success to a silent null.
export type JudgeOutcome =
  | { status: "skipped-no-key" }
  | { status: "ran"; result: FaithfulnessResult }
  | { status: "error"; model: string; message: string };

const JUDGE_SYSTEM =
  "You are a strict faithfulness judge for a Bible-study assistant. Given an " +
  "ANSWER and the EVIDENCE it was built from, break the answer into atomic " +
  "factual statements. For each, decide whether it is directly supported by the " +
  "EVIDENCE alone. Do not use outside knowledge. SBLGNT Greek is the citation " +
  "authority; the WEB English is a display aid only.";

function clip(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 300); // sanitized: bounded, no secrets/stack
}

// Skipped when no AI_GATEWAY_API_KEY. Otherwise runs with a timeout; any
// error/timeout becomes status "error" (never throws, never blocks the report).
export async function judgeFaithfulness(
  answer: string,
  evidence: EvidencePacket
): Promise<JudgeOutcome> {
  if (!process.env.AI_GATEWAY_API_KEY) return { status: "skipped-no-key" };
  try {
    const { object } = await generateObject({
      model: EVAL_JUDGE_MODEL,
      schema: faithfulnessSchema,
      system: JUDGE_SYSTEM,
      prompt: `EVIDENCE:\n${evidence.formattedEvidence}\n\nANSWER:\n${answer}`,
      abortSignal: AbortSignal.timeout(EVAL_JUDGE_TIMEOUT_MS)
    });
    const claims = object.claims ?? [];
    // An empty claims array is NOT a vacuous perfect score: it means the judge
    // could not decompose the answer into atomic statements (e.g. a very short
    // or evasive answer). Scoring it 1.0 inflates mean faithfulness; scoring it
    // 0 deflates it just as misleadingly. Surface it as an explicit error so it
    // is excluded from the mean and shown in the report's judge-error block,
    // never silently folded into a real score.
    if (claims.length === 0) {
      return {
        status: "error",
        model: EVAL_JUDGE_MODEL,
        message: "judge returned zero claims (answer not decomposable into statements)"
      };
    }
    const supported = claims.filter((c) => c.supported).length;
    const score = supported / claims.length;
    return { status: "ran", result: { score, claims, model: EVAL_JUDGE_MODEL } };
  } catch (err) {
    return { status: "error", model: EVAL_JUDGE_MODEL, message: clip(err) };
  }
}
