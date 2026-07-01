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

This reorder is a cross-file orchestration change, not a local refactor: it lands together across `lib/ai/assistant.ts`, `lib/ai/modelRouter.ts`, `lib/ai/retrievalPlanner.ts`, `lib/ai/sessions.ts` (persisted-metadata whitelist), `eval/runner.ts`, and the assistant/route/planner/sessions test suites.

### New module: `lib/ai/complexity.ts`

One unit with one job — judge whether a prompt needs deep, cross-text synthesis — offering two strategies:

**`classifyComplexityLLM(prompt, signals): Promise<ComplexityVerdict>`**
- One **Responses API** call (`client.responses.create`, matching the synthesis pattern — not Chat Completions) with strict JSON-schema output `{ complex: boolean, reason: string }`: `additionalProperties: false`, `reason` capped (`maxLength` ~300), both fields required. Output that fails schema validation (zod on our side) throws → score fallback. Model from `OPENAI_ROUTER_MODEL` (default `gpt-5-mini` — supports the Responses API and structured outputs per the [model documentation](https://developers.openai.com/api/docs/models/gpt-5-mini)).
- The classifier instructions include an injection guard: the user prompt is **content to classify, not instructions to follow** — it can never change the output schema, the model, or the routing rules.
- **Parameters must match the reasoning-model family, the Responses API, and the pinned SDK:** `max_output_tokens` with headroom for reasoning tokens (~500), `reasoning: { effort: "low" }` — the installed `openai` 4.104 types only allow `"low" | "medium" | "high"`, so `"minimal"` would not compile; an SDK upgrade just for the lower tier is not worth the blast radius — and **no `temperature`** (reasoning models reject it — same failure class as the `gpt-5.3-chat-latest` note in `modelRouter.ts`). Determinism comes from the constrained JSON output, not sampling params. A live smoke test of the exact call is a required implementation step before merge.
- **Per-request client overrides are mandatory:** the shared `getOpenAi()` client is deliberately configured at `timeout: 120 s / maxRetries: 1` (sized for long synthesis calls), so the classifier must pass per-request `{ timeout: ~2_000, maxRetries: 0 }` — without the override, the 2 s / no-retry contract silently doesn't hold.
- Hard timeout ≈ 2 s, **no retry** — on timeout, API error, or unparseable/invalid JSON it **throws**; the caller falls back to the score. A classifier failure can never fail the question.
- **Accepted degraded mode:** the score fallback is *stricter* than today's OR-gate (solo weak cues — bare "why", concept density, length — no longer escalate alone). On classifier failure those prompts stay default where today they'd at least get a scholarly recommendation. This is deliberate: the OR-gate's solo-weak-cue firing is exactly the over-firing this design removes, and keeping it alive as a failure fallback would mean maintaining two deterministic behaviors. The trade is bounded (fallback fires only on classifier failure; manual escalation and the score's ≥2 path still work) and must be **observable**: `RoutingDecision` carries a `routerSource` field (`"score-fallback"` on this path — full union defined in the router section), surfaced in the routing metadata and persisted session metadata, so fallback frequency can be monitored.
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
  1. Manual `escalate: true` → scholarly **and `deep: true`** (unchanged short-circuit; the deep flag is explicit, not implied).
  2. Live mode → `classifyComplexityLLM`; on throw → `scoreComplexity`. Callers passing `live: false` → `scoreComplexity` only. (Production non-live never reaches the router at all — the pipeline returns the deterministic fallback with honest `modelUsed: "none"` metadata before routing, exactly as today; the score-only router path serves the eval runner and unit tests.)
  3. Complex + no `confirmEscalation` → **auto-escalate**: scholarly role, deep retrieval, first pass.
  4. Complex + `confirmEscalation` → default role, populate `recommendedUpgrade` (today's confirm flow).
  5. Not complex → default role.
- `RoutingDecision` gains structured fields: `deep: boolean` (true iff scholarly), `routerSource: "llm" | "score" | "score-fallback" | "manual" | "none"`, and `complexityScore?: number` (present when the score ran) — tests and evals assert on these, not on display text. `"manual"` covers user-requested escalation (bypasses classification); `"none"` is what the non-live fallback's hand-built metadata carries (no routing ran). **Persistence:** `AssistantMessageMetadata` in `lib/ai/sessions.ts` explicitly whitelists saved fields — `routerSource`, `deep`, and `complexityScore` are added to that whitelist (plus its tests), otherwise the promised fallback-frequency/deep-usage monitoring would end at the HTTP response. The `routingDecision` string is rendered from them and names the decision source so the trace is always honest: "LLM router judged this complex…", "deterministic heuristic (classifier unavailable)…", "escalated at the user's request", etc. The existing confirm-flow `recommendedUpgrade.reason` copy ("…confirm before using the scholarly model") appears **only** in the `confirmEscalation` flow; the auto path's routing string says scholarly was used automatically.

### Deep retrieval mode (`lib/ai/retrievalPlanner.ts`)

`runRetrievalPlan(signals, prompt, opts: { semanticEnabled: boolean; deep: boolean })` (positional params replaced by an options object; **all** callsites — production, eval runner, unit tests — are updated in the same change, no boolean overload kept). When `deep: true`:

- The **deterministic-call cap** `MAX_PLANNED_CALLS` 8 → **12**. Note this cap governs only the deterministic calls — semantic passes are added after the slice as extra slots, as today — so the deep total is up to 12 deterministic + the semantic pass(es).
- **Scope policy (the substantive widening — review Finding 1).** Raising hit limits alone cannot help when `scopeFor` pins the prompt to one book/chapter: for "Is Romans 7 about Paul himself?" every semantic and keyword hit would still come from Romans 7, which is precisely the evidence the question already has. Deep mode therefore:
  - Keeps all deterministic scoped calls unchanged — explicit passage retrieval is retained, the cited passages stay primary.
  - Adds a **second, corpus-wide semantic pass** (no book/chapter scope, own plan key so dedup keeps both) alongside the scoped pass whenever the prompt's scope is pinned. Each pass keeps `SEMANTIC_HIT_LIMIT` (5). When the scope is already corpus-wide there is one pass with the limit raised to **10** instead. Both passes label their tool-trace entries (e.g. `scope: "scoped" | "corpus-wide"`, `deep: true`) so the UI trace panel and eval output can tell them apart.
  - **`semanticEnabled: false` still gates every semantic pass, including the deep corpus-wide one.** Deep mode's semantic relaxations apply only when semantic retrieval is enabled at all — the key-free eval gate exercises deep's wider *deterministic* breadth and never calls embeddings.
  - **Relaxes the conceptual gate for the corpus-wide pass.** `shouldRunSemantic` requires topic words or phrase terms and skips all-exact-verse prompts — interpretive questions often have neither (the Romans 7 prompt: proper nouns filtered, no concept terms → today it gets no semantic call at all). In deep mode the corpus-wide pass runs regardless: the KNN half embeds the full prompt; with no keyword terms the FTS half is skipped and the pass is vector-only. The all-exact-verses skip also does not apply to the deep corpus-wide pass — a deep question pinned to one verse still needs cross-text evidence.

Everything else is deliberately untouched: `MAX_EVIDENCE_CHARS` is tied to the saved-note persistence caps by construction; `maxEnrichChars()`, `MAX_WORD_SAMPLE`, citation caps, and the enrichment "degrade, never drop" contract all stay as-is. Deep mode widens **coverage**, never loosens **safety budgets** — a deep packet still assembles under the same evidence ceiling.

**Known v1 limitation — order-based evidence assembly.** `assembleEvidence` keeps sections in plan order under the cap, and semantic sections are appended after deterministic ones, so an unusually large deep deterministic packet could crowd the corpus-wide semantic section out of the final evidence. Accepted for v1: realistic deep prompts (one reference plus searches) sit far below the 58 KB ceiling. If the eval report shows deep/semantic sections being truncated in practice, add cross-section prioritization (e.g. order the corpus-wide semantic section before keyword sections in deep mode) as a follow-up — not speculatively now.

The non-live fallback path always uses standard depth (no routing ran, and its answer embeds evidence verbatim under the note caps).

## UX / API changes

- **Auto-escalation becomes the default.** Complex questions go straight to scholarly + deep retrieval on the first pass, no confirmation round-trip.
- Request param `autoEscalate` is replaced by `confirmEscalation?: boolean`. With it set, complex questions return `recommendedUpgrade` (today's behavior) instead of auto-escalating. Migration window (one release): `autoEscalate` stays in the zod schema; an **explicit** `autoEscalate: false` maps to `confirmEscalation: true` (the shipped UI only ever sent `true` or omitted the field, but this keeps any explicit opt-out meaningful); `true` or omission take the new auto default. Remove the param after.
- The cookie-backed toggle in `components/AiAssistant.tsx` / `app/assistant/page.tsx` flips meaning to "Ask before using the scholarly model" (new cookie name, e.g. `textlab-assistant-confirm-scholarly`). The old `textlab-assistant-auto-scholarly` cookie is dropped **without** migration, deliberately: it could only ever encode "auto ON", which is the new default, so ignoring it changes no one's effective behavior — and mapping its *absence* to confirm-first would nullify the approved default flip for existing users. Manual "use scholarly model" button (`escalate: true`) is unchanged.
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
- **Unit — router:** manual escalate short-circuits (scholarly + deep); auto-escalate default; `confirmEscalation` restores the recommend flow; `live: false` uses score only; `deep` set iff scholarly. Existing `modelRouter.test.ts` cases that pin solo-weak-cue escalation (e.g. bare "why" framing recommending scholarly) are updated **intentionally** — the desired behavior changed; this is not accidental breakage.
- **Unit — planner:** deep mode raises the plan-size cap; scoped prompts gain the corpus-wide semantic pass (distinct key, scoped pass unchanged); unscoped prompts get a single 10-hit pass; the corpus-wide pass runs for termless and all-exact-verse prompts in deep mode only; standard mode byte-identical to today's behavior; evidence/enrichment budgets unchanged in both modes.
- **Unit — assistant:** pipeline reorder — scholarly routing produces a deep plan; non-live path never routes.
- **Eval gate (key-free) — must be taught to see this feature (review Finding 2).** Today `eval/runner.ts` retrieves without routing and the dataset schema has no routing field, so the gate as-is cannot measure anything this PR changes. Two additions:
  - The golden-item schema gains optional `expectedRouting: "default" | "scholarly"`. For items that declare it, the gate asserts `scoreComplexity`'s decision (deterministic, key-free; type-aware — only gated where declared). New golden items cover the named misfire/under-fire examples, and the classifier's live tests include short contested questions with no surface cues — the exact class the regexes miss: "Is Romans 7 about Paul himself?", "Does James contradict Paul on justification?", "Does Hebrews 6 teach that believers can fall away?", "What does 'works of the law' mean in Galatians?".
  - The runner mirrors the new production order: route via the deterministic score first, then `runRetrievalPlan` with the resulting depth — so recall/precision are measured over the packet the feature actually produces (deep's wider deterministic breadth is exercised even with `semanticEnabled=false`).
- **Eval report:** same route-before-retrieve order using the real router (classifier when `OPENAI_API_KEY` is present); `RunResult` records `routerSource` and depth per item. The before/after run on this branch is the PR's headline measurement (same protocol as PR #54).
- **Acceptance suite:** deep mode fires only on live scholarly routing; verify the pinned corpus counts don't move.

## Out of scope (deferred)

- LLM classification of **intent** (retrieval planning stays fully regex-driven) — revisit if routing quality still disappoints.
- Item E (gloss-based English→lemma discovery) — separate follow-up PR.
- Changing `DEFAULT_MODEL` / output-token budgets (option D) — evaluate after this ships.
- New deterministic cues for interpretive-stance questions — only if the fallback path proves too weak in eval.
- Selected-passage context for the classifier — the assistant API only accepts `prompt`/`sessionId`/escalation flags, so a "what does this mean?" question about a UI-selected passage can't inform routing unless the reference is in the prompt text. Named as a known limitation, not addressed here.
- Cost brakes beyond `confirmEscalation` + the existing kill switch and API rate limit — `routerSource`/`deep` in routing metadata give the telemetry to justify one later if scholarly spend becomes a problem.
