// lib/ai/complexity.ts
// One job: judge whether a prompt needs deep, cross-text synthesis.
// Two strategies: a pure weighted score (deterministic floor — eval gate, kill
// switch, classifier failure) and an LLM classifier (live path, added in Task 2).
import { detectConceptWords, type Signals } from "@/lib/ai/signals";

export type ComplexityScore = { score: number; complex: boolean };

// Escalate at score >= 2: strong cues (weight 2) escalate alone; weak cues
// (weight 1) each need a second signal. This deliberately does NOT try to catch
// interpretive-stance questions with no surface cues ("Is Romans 7 about Paul
// himself?") — that is the LLM classifier's job; the score is a sane floor.
export const COMPLEXITY_THRESHOLD = 2;

const SCHOLARLY_CUE_RE =
  /\b(scholarly|deep synthesis|theological nuance|interpretive options|reconcile|reconciliation between|tension|paradox|harmonize|ambiguity|ambiguous)/i;
const HOW_CAN_BOTH_RE = /\bhow (can|do|does)\b[\s\S]{0,60}\band\b/i;
// "why does/do/did …" is interpretive framing, but alone it over-fires
// ("Why did Paul write Romans?") — weight 1, needs a partner cue.
const WHY_FRAMING_RE = /\bwhy (do|does|did)\b/i;

export function scoreComplexity(prompt: string, signals?: Signals): ComplexityScore {
  const distinctBooks = new Set((signals?.references ?? []).map((r) => r.book)).size;
  // Concept count comes from detectConceptWords (frozen base stoplist), NOT
  // signals.topicWords (search-tunable), so tuning the search stoplist can never
  // shift scholarly routing.
  const conceptCount = detectConceptWords(prompt).length;
  const longPrompt = prompt.trim().split(/\s+/).length > 30;
  const intent = signals?.intent;

  let score = 0;
  if (intent === "comparison") score += 2;
  if (distinctBooks >= 2) score += 2;
  if (SCHOLARLY_CUE_RE.test(prompt)) score += 2;
  if (HOW_CAN_BOTH_RE.test(prompt)) score += 2;
  if (WHY_FRAMING_RE.test(prompt)) score += 1;
  // A topic survey ("find verses about faith, hope, and love") or a recite
  // request is retrieval, not synthesis — bare concept density never counts there.
  if (intent !== "topic-survey" && intent !== "passage-recite" && conceptCount >= 3) score += 1;
  if (longPrompt) score += 1;

  return { score, complex: score >= COMPLEXITY_THRESHOLD };
}
