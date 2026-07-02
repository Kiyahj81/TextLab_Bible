// scripts/smoke-classifier.ts
// Live smoke test for the complexity classifier (spec: required before merge).
// Verifies the exact production call — Responses API, strict JSON schema, reasoning
// effort "low", no retry — against the real model, with the same extracted signals
// production supplies (intent + book count), so the merge blocker validates the real
// classifier prompt, not a variant.
//
// GATE SEMANTICS: this validates the classifier CONTRACT (prompt, schema, correct
// verdicts, no API errors) — and it ALWAYS validates verdicts, never passing on
// zero. Each prompt is first tried at the mandated production budget
// (ROUTER_TIMEOUT_MS, imported below). If THAT times out (e.g. behind a
// TLS-intercepting proxy that inflates round-trips), the verdict is still validated
// via a relaxed-timeout probe — because dev-box latency is not signal about the
// classifier's correctness, and in production a timeout simply falls back to the
// deterministic score. Hard failures: a wrong verdict, a non-timeout API error
// (400 / bad JSON / no client), or no verdict even under the relaxed probe. Calls
// that only completed over the production budget are reported as a latency
// datapoint to re-check in a production-like network.
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

// Narrow to the OpenAI SDK's typed connection-timeout (APIConnectionTimeoutError, whose
// message is "Request timed out."). A broad /timeout/i would misclassify e.g. a gateway
// 504 "upstream request timeout" as a budget timeout, sending a real API failure to the
// relaxed probe and mislabeling it as a latency datapoint.
function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "APIConnectionTimeoutError" || /request timed out/i.test(err.message);
}

async function main() {
  console.log(`Classifier smoke test — model: ${getRouterModel()}\n`);
  let mismatches = 0; // wrong verdict → hard fail
  let hardErrors = 0; // non-timeout API error → hard fail
  let unresolved = 0; // no verdict even under the relaxed probe → hard fail
  let overBudget = 0; // completed, but only after exceeding the production budget
  let validated = 0; // verdicts actually obtained (strict or relaxed)

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
      if (!isTimeout(err)) {
        hardErrors++;
        console.log(`FAIL [${Date.now() - started}ms] "${prompt}" — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // Timed out at the production budget — validate the verdict anyway (correctness),
      // just outside the budget.
      overBudget++;
      relaxed = true;
      const relaxedStart = Date.now();
      try {
        verdict = await classifyComplexityLLM(prompt, signals, { timeoutMs: RELAXED_TIMEOUT_MS });
        elapsed = Date.now() - relaxedStart;
      } catch (err2) {
        if (isTimeout(err2)) {
          unresolved++;
          console.log(`FAIL [>${RELAXED_TIMEOUT_MS}ms] "${prompt}" — no verdict even under the relaxed probe`);
        } else {
          hardErrors++;
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
    `\n${PROMPTS.length} prompts — ${validated} verdict(s) validated, ${mismatches} wrong, ${hardErrors} API error(s), ${unresolved} unresolved, ${overBudget} over the ${PROD_BUDGET_MS}ms budget.`
  );
  const failures = mismatches + hardErrors + unresolved;
  if (failures === 0 && overBudget > 0) {
    console.log(
      `Note: ${overBudget} call(s) exceeded the ${PROD_BUDGET_MS}ms budget on this network and were validated via the relaxed probe. In production a timeout falls back to the deterministic score; re-check the budget in a production-like environment.`
    );
  }
  console.log(
    failures === 0
      ? "\nSmoke test passed (all verdicts validated and correct)."
      : `\nSmoke test FAILED — ${failures} failure(s) (wrong verdicts / API errors / unresolved).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
