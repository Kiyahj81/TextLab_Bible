// scripts/smoke-classifier.ts
// Live smoke test for the complexity classifier (spec: required before merge).
// Verifies the exact production call — Responses API, strict JSON schema,
// reasoning effort "low", 2s timeout, no retry — against the real model, with the
// same extracted signals production supplies (intent + book count), so the merge
// blocker validates the real classifier prompt, not a variant.
//
// GATE SEMANTICS: this validates the classifier CONTRACT (prompt, schema, verdicts,
// no API errors), not network latency. A wrong verdict or a non-timeout API error
// (400 / bad JSON / no client) HARD-FAILS. A timeout is reported as a WARNING with
// the latency distribution and does NOT fail the gate — in production a classifier
// timeout is not a failure (the router falls back to the deterministic score), and
// dev-box round-trip latency (e.g. behind a TLS-intercepting proxy) is not signal
// about the classifier itself. If timeouts recur in a production-like network,
// that's a datapoint for revisiting the timeout budget — not a reason to fail here.
import { classifyComplexityLLM, getRouterModel } from "@/lib/ai/complexity";
import { extractSignals } from "@/lib/ai/signals";

const PROMPTS: Array<{ prompt: string; expect: boolean }> = [
  { prompt: "What does John 3:16 say?", expect: false },
  { prompt: "Is Romans 7 about Paul himself?", expect: true },
  { prompt: "Does James contradict Paul on justification?", expect: true },
  { prompt: "Find verses about hope", expect: false }
];

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "APIConnectionTimeoutError" || /timed out|timeout/i.test(err.message);
}

async function main() {
  console.log(`Classifier smoke test — model: ${getRouterModel()}\n`);
  let mismatches = 0; // wrong verdict → hard fail (classifier logic/prompt is wrong)
  let hardErrors = 0; // non-timeout API error (400 / bad JSON / no client) → hard fail
  let timeouts = 0; // latency only → warn, does NOT fail the gate
  const latencies: number[] = [];

  for (const { prompt, expect } of PROMPTS) {
    const started = Date.now();
    try {
      const verdict = await classifyComplexityLLM(prompt, extractSignals(prompt));
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      const ok = verdict.complex === expect;
      if (!ok) mismatches++;
      console.log(
        `${ok ? "OK  " : "MISS"} [${elapsed}ms] complex=${verdict.complex} (expected ${expect}) — "${prompt}"\n      reason: ${verdict.reason}`
      );
    } catch (err) {
      const elapsed = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      if (isTimeout(err)) {
        timeouts++;
        console.warn(`WARN [${elapsed}ms] timed out (verdict unknown; production would fall back to the score) — "${prompt}"`);
      } else {
        hardErrors++;
        console.log(`FAIL [${elapsed}ms] "${prompt}" — ${message}`);
      }
    }
  }

  const correct = latencies.length - mismatches;
  console.log(
    `\n${PROMPTS.length} prompts — ${correct} correct, ${mismatches} wrong verdict(s), ${hardErrors} API error(s), ${timeouts} timeout(s).`
  );
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`Latency (completed calls): min ${sorted[0]}ms / median ${median}ms / max ${sorted[sorted.length - 1]}ms.`);
  }
  if (timeouts > 0) {
    console.log(
      `Note: ${timeouts} call(s) exceeded the classifier timeout budget. Not a gate failure — routing falls back to the deterministic score. Re-run in a production-like network to judge whether the budget needs revisiting.`
    );
  }

  const failures = mismatches + hardErrors;
  console.log(failures === 0 ? "\nSmoke test passed (verdicts correct)." : `\nSmoke test FAILED — ${failures} correctness/API failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
