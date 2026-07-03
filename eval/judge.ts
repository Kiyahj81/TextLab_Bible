// eval/judge.ts
import { APICallError, generateObject } from "ai";
import { z } from "zod";
import type { EvidencePacket } from "@/lib/ai/retrievalPlanner";

// Bare creator/model slug routed through the AI SDK's Vercel AI Gateway global
// provider (authenticated by AI_GATEWAY_API_KEY) — same mechanism as rerank.ts.
// NOTE THE SLUG FORM: the Gateway catalog uses the bare creator/model form
// (`anthropic/claude-sonnet-5`), matching `voyage/rerank-2.5` in rerank.ts. If
// you pin a model whose id carries a minor version, spell that version with a
// DOT as the Gateway catalog does (`...sonnet-X.Y`), NOT the hyphenated
// direct-API form (`...sonnet-X-Y`), which errors on the Gateway. VERIFY the
// exact slug against the current Vercel AI Gateway model list before first run;
// on a wrong slug the judge reports status "error" (visible in the report), it
// does not silently vanish.
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-5";
// PER-ATTEMPT budget (not total): each of the MAX_ATTEMPTS calls gets a fresh
// AbortSignal.timeout, so the worst case is MAX_ATTEMPTS × timeout + backoffs.
// Default 90s (was 30s): the report is non-blocking and never latency-sensitive,
// and 30s produced 10-11 judge errors per 26-item local run (2026-07-02) — the
// same aborts that forced CI to override to 90s back in June. A default that only
// works when overridden is a footgun; 90s is the value both venues actually need.
export const EVAL_JUDGE_TIMEOUT_MS =
  Number(process.env.EVAL_JUDGE_TIMEOUT_MS) > 0 ? Number(process.env.EVAL_JUDGE_TIMEOUT_MS) : 90_000;

// Retries are implemented HERE, with the SDK's own retries disabled
// (maxRetries: 0). The SDK's backoff shares the caller's abort signal, and when
// the signal fires mid-backoff the in-flight attempt's error is discarded — the
// report then shows only "Delay was aborted" with the real cause (429/529/5xx)
// swallowed. Owning the loop keeps every attempt's error for the report.
const MAX_ATTEMPTS = 3; // parity with the SDK default (1 try + 2 retries)
const RETRY_BACKOFF_MS = [2_000, 4_000]; // before attempt 2 / attempt 3 (SDK parity)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

// Per-attempt clip (90, not 300): three attempts must fit the report's bounded
// 300-char message; sanitized — message text only, no secrets/stack.
function clip(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 90);
}

// Our own AbortSignal.timeout firing mid-request surfaces as an
// AbortError/TimeoutError DOMException depending on where it lands.
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

// Retry what the SDK would have: retryable API errors (429/5xx/overloaded) —
// plus our per-attempt timeouts, since each retry gets a fresh budget.
function isRetryable(err: unknown): boolean {
  return isTimeout(err) || (APICallError.isInstance(err) && err.isRetryable);
}

function describeAttemptError(err: unknown): string {
  if (isTimeout(err)) return `timed out after ${EVAL_JUDGE_TIMEOUT_MS}ms`;
  if (APICallError.isInstance(err) && err.statusCode != null) return `HTTP ${err.statusCode}: ${clip(err)}`;
  return clip(err);
}

// Skipped when no AI_GATEWAY_API_KEY. Otherwise up to MAX_ATTEMPTS calls, each
// with a fresh timeout; any final error/timeout becomes status "error" listing
// every attempt's cause (never throws, never blocks the report).
export async function judgeFaithfulness(
  answer: string,
  evidence: EvidencePacket
): Promise<JudgeOutcome> {
  if (!process.env.AI_GATEWAY_API_KEY) return { status: "skipped-no-key" };
  const attemptErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: EVAL_JUDGE_MODEL,
        schema: faithfulnessSchema,
        system: JUDGE_SYSTEM,
        prompt: `EVIDENCE:\n${evidence.formattedEvidence}\n\nANSWER:\n${answer}`,
        maxRetries: 0, // retries owned by this loop — see RETRY_BACKOFF_MS note
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
      attemptErrors.push(`attempt ${attempt}: ${describeAttemptError(err)}`);
      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        await sleep(RETRY_BACKOFF_MS[attempt - 1]);
        continue;
      }
      break; // non-retryable, or attempts exhausted
    }
  }
  return {
    status: "error",
    model: EVAL_JUDGE_MODEL,
    message: attemptErrors.join("; ").slice(0, 300) // bounded for the report
  };
}
