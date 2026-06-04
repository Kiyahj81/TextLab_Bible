// Phase 4b rerank diff harness. For each prompt, prints the semantic candidate
// ordering WITHOUT rerank (RRF) and WITH rerank (Voyage via AI Gateway), so the
// reordering can be eyeballed. Requires DATABASE_URL + OPENAI_API_KEY; rerank rows
// only differ when AI_GATEWAY_API_KEY is also set (else both columns match).
//
// Working invocation (loads .env automatically):
//   npx tsx --env-file=.env scripts/rerank-diff.ts

import { searchSemantic } from "../lib/search";
import { extractSignals } from "../lib/ai/signals";

const PROMPTS = [
  "what does Paul say about reconciliation between people and God",
  "where does the New Testament talk about grace and truth",
  "trace the theme of love in 1 John",
  "verses about light overcoming darkness",
  "what is the meaning of being justified by faith"
];

async function main() {
  for (const query of PROMPTS) {
    // Derive FTS keywords EXACTLY as retrievalPlanner.ts does, so the RRF baseline
    // matches the production assistant path (not an ad-hoc last-two-words heuristic).
    const signals = extractSignals(query);
    const keywords = [...signals.topicWords, ...(signals.phraseTerms ?? [])].join(" ");
    const [rrf, reranked] = await Promise.all([
      searchSemantic({ query, keywords, limit: 5, rerank: false }),
      searchSemantic({ query, keywords, limit: 5, rerank: true })
    ]);
    console.log("=".repeat(80));
    console.log("PROMPT:", query);
    console.log("  RRF     :", rrf.map((r) => r.reference).join(", ") || "(none)");
    console.log("  RERANKED:", reranked.map((r) => r.reference).join(", ") || "(none)");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
