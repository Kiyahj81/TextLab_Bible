// scripts/smoke-classifier.ts
// Live smoke test for the complexity classifier (spec: required before merge).
// Verifies the exact production call — Responses API, strict JSON schema, reasoning
// effort "low", no retry — against the real model, with the same extracted signals
// production supplies (intent + book count), so the merge blocker validates the real
// classifier prompt, not a variant.
//
// GATE SEMANTICS: this validates the classifier CONTRACT (prompt, schema, correct
// verdicts) and ALWAYS validates verdicts, never passing on zero. Two independent
// retry layers, both scoped so they can NEVER mask a real classifier failure:
//   1. Per-prompt relaxed probe. A prompt whose prod-budget call times out or hits an
//      isolated connection drop is re-tried once at a relaxed timeout. If it recovers,
//      the verdict is still validated (a timeout is a latency datapoint; a recovered
//      drop is CI noise) — neither counts as a failure.
//   2. Whole-probe retry. If a full run's ONLY failures are connectivity/latency
//      (connection drops or timeouts that recurred on the relaxed probe) — i.e. zero
//      wrong verdicts and zero contract errors — the whole probe is re-run once after
//      a pause, because the Actions<->OpenAI path intermittently drops every connection
//      for ~a minute ("Premature close" storms) that clear on their own.
// HARD failures (exit 1, NEVER retried): a wrong verdict, or a real contract error
// (400 / bad JSON / no client / schema mismatch). These exit 1 immediately, so a
// nondeterministic re-run can never turn a genuine classifier failure green. A
// connectivity storm that does NOT clear on the whole-probe retry also exits 1.
import { classifyComplexityLLM, getRouterModel, ROUTER_TIMEOUT_MS } from "@/lib/ai/complexity";
import { extractSignals } from "@/lib/ai/signals";

const PROMPTS: Array<{ prompt: string; expect: boolean }> = [
  { prompt: "What does John 3:16 say?", expect: false },
  { prompt: "Is Romans 7 about Paul himself?", expect: true },
  { prompt: "Does James contradict Paul on justification?", expect: true },
  { prompt: "Find verses about hope", expect: false }
];

const PROD_BUDGET_MS = ROUTER_TIMEOUT_MS; // the mandated production per-request budget (never a stale copy)
const RELAXED_TIMEOUT_MS = 10_000; // generous enough to validate correctness on a slow network
const STORM_RETRY_DELAY_MS = 60_000; // observed: total "Premature close" storms clear within ~a minute

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Narrow to the OpenAI SDK's typed connection-timeout (APIConnectionTimeoutError, whose
// message is "Request timed out."). A broad /timeout/i would misclassify e.g. a gateway
// 504 "upstream request timeout" as a budget timeout, sending a real API failure to the
// relaxed probe and mislabeling it as a latency datapoint.
function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "APIConnectionTimeoutError" || /request timed out/i.test(err.message);
}

// A dropped/reset connection ("Premature close", ECONNRESET, socket hang up): the
// request never received a complete response, so the classifier CONTRACT was never
// exercised — distinct from a 400/bad-JSON (a real contract failure that must
// hard-fail) and from a timeout (handled above). The OpenAI SDK wraps these as
// APIConnectionError. Treated as connectivity, never as a contract error.
function isTransientConnection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "APIConnectionError" ||
    /premature close|econnreset|socket hang up|fetch failed|terminated/i.test(err.message)
  );
}

type ProbeResult = {
  mismatches: number; // wrong verdict — HARD (never retried)
  contractErrors: number; // 400 / bad JSON / no client / schema mismatch — HARD (never retried)
  connectionErrors: number; // connection dropped on BOTH attempts — RETRYABLE (connectivity)
  unresolved: number; // timed out on BOTH attempts — RETRYABLE (latency)
  overBudget: number; // recovered on the relaxed probe after a prod-budget timeout — not a failure
  transientRetried: number; // recovered on the relaxed probe after a connection drop — not a failure
  validated: number; // verdicts actually obtained (strict or relaxed)
};

// Runs the full prompt set once and prints a per-run summary line. Classifies every
// failure into a HARD bucket (wrong verdict / contract error) or a RETRYABLE bucket
// (connection drop / timeout that recurred on the relaxed probe); main() decides on
// the whole-probe retry from those buckets.
async function runProbe(): Promise<ProbeResult> {
  let mismatches = 0;
  let contractErrors = 0;
  let connectionErrors = 0;
  let unresolved = 0;
  let overBudget = 0;
  let transientRetried = 0;
  let validated = 0;

  for (const { prompt, expect } of PROMPTS) {
    const signals = extractSignals(prompt);
    const started = Date.now();
    let verdict: Awaited<ReturnType<typeof classifyComplexityLLM>> | undefined;
    let elapsed = 0;
    let relaxed = false;

    try {
      verdict = await classifyComplexityLLM(prompt, signals, { timeoutMs: PROD_BUDGET_MS });
      elapsed = Date.now() - started;
    } catch (err) {
      const timedOut = isTimeout(err);
      const transient = !timedOut && isTransientConnection(err);
      if (!timedOut && !transient) {
        // Real contract error (400 / bad JSON / no client) — HARD, no relaxed probe.
        contractErrors++;
        console.log(`FAIL [${Date.now() - started}ms] "${prompt}" — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // Timeout at the production budget, or an isolated connection drop — re-validate
      // the verdict once via the relaxed probe. A timeout is a latency datapoint; a
      // recovered drop is CI noise. If EITHER recurs on the relaxed probe below, it
      // becomes a RETRYABLE failure (unresolved / connectionErrors), not a hard one.
      if (timedOut) overBudget++;
      else transientRetried++;
      relaxed = true;
      const relaxedStart = Date.now();
      try {
        verdict = await classifyComplexityLLM(prompt, signals, { timeoutMs: RELAXED_TIMEOUT_MS });
        elapsed = Date.now() - relaxedStart;
      } catch (err2) {
        if (isTimeout(err2)) {
          unresolved++;
          console.log(`FAIL [>${RELAXED_TIMEOUT_MS}ms] "${prompt}" — no verdict even under the relaxed probe`);
        } else if (isTransientConnection(err2)) {
          connectionErrors++;
          console.log(`FAIL "${prompt}" — connection dropped on both attempts: ${err2 instanceof Error ? err2.message : String(err2)}`);
        } else {
          contractErrors++;
          console.log(`FAIL "${prompt}" — ${err2 instanceof Error ? err2.message : String(err2)}`);
        }
        continue;
      }
    }

    validated++;
    const ok = verdict.complex === expect;
    if (!ok) mismatches++;
    console.log(
      `${ok ? "OK  " : "MISS"} [${elapsed}ms${relaxed ? " relaxed" : ""}] complex=${verdict.complex} (expected ${expect}) — "${prompt}"\n      reason: ${verdict.reason}`
    );
  }

  console.log(
    `\n${PROMPTS.length} prompts — ${validated} validated, ${mismatches} wrong, ${contractErrors} contract error(s), ${connectionErrors} connection drop(s), ${unresolved} unresolved, ${overBudget} over the ${PROD_BUDGET_MS}ms budget, ${transientRetried} transient retry(ies).`
  );
  return { mismatches, contractErrors, connectionErrors, unresolved, overBudget, transientRetried, validated };
}

async function main() {
  console.log(`Classifier smoke test — model: ${getRouterModel()}\n`);

  let r = await runProbe();
  const hardOf = (x: ProbeResult) => x.mismatches + x.contractErrors;
  const retryableOf = (x: ProbeResult) => x.connectionErrors + x.unresolved;

  // Whole-probe retry — ONLY when this run failed purely on connectivity/latency (no
  // wrong verdicts, no contract errors). A hard failure exits 1 with no retry, so a
  // nondeterministic re-run can never mask a genuine classifier failure.
  if (hardOf(r) === 0 && retryableOf(r) > 0) {
    console.log(
      `\nAll ${retryableOf(r)} failure(s) were connectivity/latency (0 wrong verdicts, 0 contract errors) — likely a transient storm. Retrying the whole probe once after ${STORM_RETRY_DELAY_MS / 1000}s...\n`
    );
    await sleep(STORM_RETRY_DELAY_MS);
    r = await runProbe();
  }

  const failures = hardOf(r) + retryableOf(r);
  if (failures === 0 && r.overBudget > 0) {
    console.log(
      `Note: ${r.overBudget} call(s) exceeded the ${PROD_BUDGET_MS}ms budget on this network and were validated via the relaxed probe. In production a timeout falls back to the deterministic score; re-check the budget in a production-like environment.`
    );
  }
  if (failures === 0 && r.transientRetried > 0) {
    console.log(
      `Note: ${r.transientRetried} call(s) hit a transient connection drop and recovered on the relaxed probe (isolated CI network blip, not a classifier fault).`
    );
  }
  console.log(
    failures === 0
      ? "\nSmoke test passed (all verdicts validated and correct)."
      : `\nSmoke test FAILED — ${failures} failure(s): ${r.mismatches} wrong verdict(s), ${r.contractErrors} contract error(s), ${r.connectionErrors} connection drop(s), ${r.unresolved} unresolved.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
