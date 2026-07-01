# LLM Complexity Router + Deep Retrieval — Design

**Date:** 2026-07-01
**Status:** Approved design, pre-implementation
**Follows:** PR #54 (assistant grounded answers, Stage 1) — this is the first follow-up on the new baseline.

## Problem

Two coupled weaknesses in the assistant, identified after PR #54:

1. **Routing is a single-cue OR-gate** (`recommendScholarlyUpgrade` in `lib/ai/modelRouter.ts`). Any one of: comparison intent, ≥2 books, a scholarly cue word, "why does…" framing, ≥3 concept words, or >30 words marks a prompt complex. It over-fires on verbose-but-routine questions and — the dominant pain in practice — **under-fires on genuinely deep interpretive questions** that carry none of the surface cues (e.g. "Is Romans 7 about Paul himself?": one book, short, no cue words). The five post-snapshot fix commits on the Stage 1 branch were all patches to individual cues; regexes fundamentally cannot judge interpretive depth.

2. **Escalation changes the writer, not the evidence.** Going scholarly only swaps the synthesis model; the evidence packet is identical (`MAX_PLANNED_CALLS = 8`, `SEMANTIC_HIT_LIMIT = 5` serve every question). For a deep question with thin retrieval, escalation buys better prose about the same insufficient material. The ceiling on answer quality is usually the evidence packet, not the model.

Additionally, auto-escalation is opt-in behind a toggle and otherwise requires a confirmation round-trip, so even correctly detected complex questions are often answered by the default model first.

## Decision summary

| Decision | Choice |
| --- | --- |
| Primary pain | Under-escalation (missed deep questions) |
| Detector | LLM classifier in live mode; weighted regex score as deterministic fallback |
| Classifier scope | Complexity only — `detectIntent` and all retrieval signal extraction stay regex-based |
| Escalation UX | Auto-escalate by default; toggle flips to opt-out ("ask before using the scholarly model") |
| Pipeline shape | Classify **then** retrieve (blocking), so routing can widen retrieval |
| Deep retrieval | Scholarly routing widens planner coverage knobs; safety budgets untouched |

## Architecture

### New pipeline order in `answerBibleQuestion` (`lib/ai/assistant.ts`)

Today retrieval runs before routing; deep retrieval requires the reverse.

1. `extractSignals(prompt)` — unchanged.
2. If live mode is off → **standard** retrieval → deterministic fallback with honest routing metadata — unchanged.
3. `await routeAssistantPrompt(prompt, options)` — now **async**; decides model role **and** retrieval depth.
4. `runRetrievalPlan(signals, prompt, { semanticEnabled, deep })` — `deep: true` iff the routing decision is scholarly (manual or auto).
5. `synthesizeWithRefinement` → `verifyGrounding` — unchanged.

### New module: `lib/ai/complexity.ts`

One unit with one job — judge whether a prompt needs deep, cross-text synthesis — offering two strategies:

**`classifyComplexityLLM(prompt, signals): Promise<ComplexityVerdict>`**
- One OpenAI chat call. Model from `OPENAI_ROUTER_MODEL` (default `gpt-5-mini`), temperature 0, small `max_tokens` (~150), strict JSON response `{ complex: boolean, reason: string }`.
- Hard timeout ≈ 2 s (SDK per-request timeout), **no retry** — on timeout, API error, or unparseable/invalid JSON it **throws**; the caller falls back to the score. A classifier failure can never fail the question; worst case is today's regex behavior.
- The prompt instructs the classifier to judge whether the question requires interpretive synthesis across texts / contested exegesis (complex) vs. lookup, recitation, word study, or routine passage explanation (not complex). It receives the user prompt plus cheap signal context (intent, distinct book count) — no corpus evidence.

**`scoreComplexity(prompt, signals): { score: number; complex: boolean }`**
- Pure, synchronous, deterministic. Replaces the OR-gate. Escalation threshold: **score ≥ 2**.

| Cue (all existing) | Weight |
| --- | --- |
| Comparison intent | +2 |
| ≥2 distinct books referenced | +2 |
| Scholarly cue words (`SCHOLARLY_CUE_RE`: reconcile, tension, harmonize, …) | +2 |
| "How can both…" framing (`HOW_CAN_BOTH_RE`) | +2 |
| "Why does/do/did…" framing (`WHY_FRAMING_RE`) | +1 |
| Concept density ≥3 (keeps the topic-survey / passage-recite exclusion) | +1 |
| Length >30 words | +1 |

- Strong cues escalate alone; each weak cue needs a second signal. "What does the fruit of the Spirit passage teach believers?" (concept density only, score 1) stays default. "Why did Paul write Romans?" (why-framing only, score 1) stays default. "Why does Paul say believers died to the law when he also upholds it?" (why + scholarly cue, score 3) escalates.
- **Deliberately no new fallback cues** for interpretive-stance questions — catching those is the LLM router's job; the score only needs to be a sane deterministic floor (eval gate, kill switch, classifier failure).

### `routeAssistantPrompt` (`lib/ai/modelRouter.ts`)

- Becomes `async`. Signature gains a `live: boolean` option; `autoEscalate` is replaced by `confirmEscalation` (see UX).
- Decision order:
  1. Manual `escalate: true` → scholarly (unchanged, short-circuits classification).
  2. Live mode → `classifyComplexityLLM`; on throw → `scoreComplexity`. Non-live callers → `scoreComplexity` only.
  3. Complex + no `confirmEscalation` → **auto-escalate**: scholarly role, deep retrieval, first pass.
  4. Complex + `confirmEscalation` → default role, populate `recommendedUpgrade` (today's confirm flow).
  5. Not complex → default role.
- `RoutingDecision` gains `deep: boolean` (true iff scholarly). The `routingDecision` string names the decision source so the trace is always honest: "LLM router judged this complex…", "deterministic heuristic (classifier unavailable) …", "escalated at the user's request", etc.

### Deep retrieval mode (`lib/ai/retrievalPlanner.ts`)

`runRetrievalPlan(signals, prompt, opts: { semanticEnabled: boolean; deep: boolean })` (positional params replaced by an options object). When `deep: true`:

- `SEMANTIC_HIT_LIMIT` 5 → **10**
- `MAX_PLANNED_CALLS` 8 → **12**

Everything else is deliberately untouched: `MAX_EVIDENCE_CHARS` is tied to the saved-note persistence caps by construction; `maxEnrichChars()`, `MAX_WORD_SAMPLE`, citation caps, and the enrichment "degrade, never drop" contract all stay as-is. Deep mode widens **coverage**, never loosens **safety budgets** — a deep packet still assembles under the same evidence ceiling.

The non-live fallback path always uses standard depth (no routing ran, and its answer embeds evidence verbatim under the note caps).

## UX / API changes

- **Auto-escalation becomes the default.** Complex questions go straight to scholarly + deep retrieval on the first pass, no confirmation round-trip.
- Request param `autoEscalate` is replaced by `confirmEscalation?: boolean`. With it set, complex questions return `recommendedUpgrade` (today's behavior) instead of auto-escalating. `autoEscalate` remains in the zod schema as accepted-but-ignored for one release so stale clients don't 400; remove after.
- The cookie-backed toggle in `components/AiAssistant.tsx` / `app/assistant/page.tsx` flips meaning to "Ask before using the scholarly model" (new cookie name; the old auto-scholarly cookie is simply ignored). Manual "use scholarly model" button (`escalate: true`) is unchanged.
- **Cost trade-off (accepted):** every question the classifier judges complex now costs a scholarly-model call plus wider retrieval without asking. The classifier call itself is negligible (~200 tokens on a mini model). `confirmEscalation` is the brake for cost-sensitive use.

## Error handling

| Failure | Behavior |
| --- | --- |
| Classifier timeout / API error / bad JSON | Fall back to `scoreComplexity`; routing string records the fallback |
| Live mode off (no key or kill switch) | No classifier call, no routing; deterministic fallback path unchanged |
| Deep retrieval call failures | Existing per-call `Promise.allSettled` + error-trace behavior, unchanged |
| Scholarly synthesis failure | Existing degradation to deterministic fallback, unchanged |

## Testing & evaluation

- **Unit — score:** table-driven over the weight matrix; threshold boundary cases; the named misfire examples (fruit-of-the-Spirit stays default; two-cue "why + tension" escalates; topic-survey/recite exclusions hold).
- **Unit — classifier:** mocked OpenAI client — valid verdict routes; timeout → score fallback; garbage JSON → score fallback; verdict shape validated with zod.
- **Unit — router:** manual escalate short-circuits; auto-escalate default; `confirmEscalation` restores the recommend flow; non-live uses score only; `deep` set iff scholarly.
- **Unit — planner:** deep mode raises plan size cap and semantic limit; standard mode byte-identical to today's behavior; evidence/enrichment budgets unchanged in both modes.
- **Unit — assistant:** pipeline reorder — scholarly routing produces a deep plan; non-live path never routes.
- **Eval gate (key-free):** exercises the deterministic score. Golden-set routing expectations are updated where the score legitimately changes an outcome — that is fixing the measurement, not lowering thresholds.
- **Eval report:** before/after run on this branch is the PR's headline measurement (same protocol as PR #54).
- **Acceptance suite:** deep mode fires only on live scholarly routing; verify the pinned corpus counts don't move.

## Out of scope (deferred)

- LLM classification of **intent** (retrieval planning stays fully regex-driven) — revisit if routing quality still disappoints.
- Item E (gloss-based English→lemma discovery) — separate follow-up PR.
- Changing `DEFAULT_MODEL` / output-token budgets (option D) — evaluate after this ships.
- New deterministic cues for interpretive-stance questions — only if the fallback path proves too weak in eval.
