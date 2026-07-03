// Tier-1 evidence-diff harness (Phase 3). Runs a fixed prompt set through the
// deterministic retrieval planner and prints assembled evidence + citations.
// Run on `main` and on the FTS branch, redirect each to a file, and diff.
// Requires DATABASE_URL in the environment (uses the real corpus). No OpenAI call.
//
// Working invocation (loads .env automatically):
//   npx tsx --env-file=.env scripts/evidence-diff.ts
// Or pre-load .env in the shell, then:
//   npx tsx scripts/evidence-diff.ts
// NOTE: `node --env-file=.env --import=tsx/esm scripts/evidence-diff.ts` does NOT
// work — under that loader the imported modules' `@/…` path aliases fail to
// resolve ("Cannot find module '../lib/ai/signals'"). Use `npx tsx` as above.

import { extractSignals } from "../lib/ai/signals";
import { runRetrievalPlan } from "../lib/ai/retrievalPlanner";

const PROMPTS = [
  "Show me every use of λόγος in John 1 and summarize the pattern.",
  "Where does the New Testament talk about grace and truth?",
  "What does John 1 say?",
  "Trace the theme of love in 1 John.",
  "Find uses of πίστις (faith) in Romans.",
  "Explain Romans 7:1-6.",
  "What is the meaning of logos?",
  "Show me verses about light and darkness.",
  "Where is the word ἀρχή used?",
  "Summarize the prologue of John."
];

async function main() {
  for (const prompt of PROMPTS) {
    const signals = extractSignals(prompt);
    // Disable semantic retrieval explicitly: this harness exists to diff the
    // DETERMINISTIC lexical/planner layer and must stay OpenAI-free and reproducible.
    // (semanticEnabled defaults to true for the production path; here we force it off
    // so no embedding call can fire and no spurious "(no matches)" semantic section or
    // consumed planner slot pollutes the diff against main.)
    const packet = await runRetrievalPlan(signals, prompt, { semanticEnabled: false });
    console.log("=".repeat(80));
    console.log("PROMPT:", prompt);
    console.log("-".repeat(80));
    console.log("CITATIONS:");
    for (const c of packet.citations) {
      console.log(`  - ${c.reference} [${c.corpus}] (${c.toolName ?? "?"})`);
    }
    console.log("-".repeat(80));
    console.log("EVIDENCE:");
    console.log(packet.formattedEvidence);
    console.log();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
