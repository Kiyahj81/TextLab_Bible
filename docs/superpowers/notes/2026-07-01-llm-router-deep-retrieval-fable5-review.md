# Fable 5 Review: LLM Complexity Router + Deep Retrieval

**Branch:** `feat/assistant-llm-router-deep-retrieval` (diff `b6edb5e..dd2f2b3`)
**Reviewer:** Claude Fable 5 (multi-agent workflow review, high effort), 2026-07-01
**Companion to:** [2026-07-01-llm-router-deep-retrieval-review-handoff.md](2026-07-01-llm-router-deep-retrieval-review-handoff.md)

**Method:** 4 finder agents (3 correctness angles + 1 cleanup) over the full branch diff, then an independent adversarial verifier per distinct (file, line) candidate — 21 candidates verified, 17 confirmed, 4 refuted, collapsing into 10 distinct defects. Binding constraints (handoff §5) and the two open decisions (§8) were reviewed directly by the primary reviewer.

---

## Bottom line

The architecture is sound and every §5 binding constraint holds — no egress regressions, `deep`/`routerSource`/`complexityScore` flow intact end-to-end, both migration truth tables match the spec. The adversarial pass found one genuine correctness bug in the back-compat story (finding 1), two graceful-degradation gaps (findings 2–3), and a real duplicate-evidence bug in deep mode (finding 4). None are architectural; all are fixable in-place before merge.

## Binding constraints (§5) — all verified

- **Non-live never routes:** `lib/ai/assistant.ts:51-64` returns before any routing; `runRetrievalPlan` gets `semanticEnabled:false`, and `buildPlan` wraps every semantic pass in `if (semanticEnabled)` — no classifier or embedding egress possible.
- **`deep === (modelRole === "scholarly")`** holds in all four router return paths.
- **Classifier per-request overrides** present exactly as mandated (`{timeout: 2000, maxRetries: 0}`, `reasoning: {effort: "low"}`, no temperature).
- **Deep retrieval:** the cap slice (`retrievalPlanner.ts:653`) happens before semantic pushes; the corpus-wide deep pass is unconditional while the scoped pass respects `shouldRunSemantic`; `semanticEnabled:false` is a hard off-switch.
- **API + cookie migrations:** `confirmEscalation ?? (autoEscalate === false ? true : false)` and `resolveConfirmScholarly` truth tables match the spec row-for-row (but see finding 1); the UI writes the new cookie durably on first mount.
- **Eval gate is key-free:** `eval/runner.ts:115` forces `live = false` in gate mode, so the gate never touches the classifier; the 6 golden routing items' score math checks out against `scoreComplexity`.

---

## Verified findings, most severe first

### 1. The `autoEscalate:false` shim protects a client that never existed — `app/api/assistant/route.ts:65` (CONFIRMED)

The shipped legacy UI at `b6edb5e` sent `...(autoScholarly && !escalate ? { autoEscalate: true } : {})` — toggle-ON attached `autoEscalate: true`, toggle-OFF **omitted the field entirely**. No shipped client ever sent `autoEscalate: false`, so the deprecated mapping (and its test) pins a phantom request shape, while a real legacy opt-out user on a stale cached bundle sends `{}` and silently gets auto-escalation + deep retrieval against their recorded preference.

Caveat: the server cannot distinguish "legacy bundle, opted out" from "new client, auto default" — both send `{}` — so the exposure is inherently limited to the stale-bundle deploy window, after which the cookie migration fixes it durably. But the shim as written is dead code that *documents* a protection it doesn't provide.

**Fix options:** delete the shim (and correct the handoff/spec claim), or if the deploy-window opt-out matters, gate auto-escalation on presence of the new `confirmEscalation` key as a client-version signal.

### 2. Bare `catch {}` makes persistent classifier failure invisible — `lib/ai/modelRouter.ts:102` (CONFIRMED)

There is zero logging anywhere in `lib/ai`. A typo'd `OPENAI_ROUTER_MODEL`, or a model that rejects `reasoning: {effort: "low"}`, 400s on *every* live request and permanently degrades routing to the stricter score — precisely the interpretive cases the LLM classifier was built to catch ("Is Romans 7 about Paul himself?" scores 0–1) get default-model shallow retrieval indefinitely, with the only trace buried in per-answer `routingDecision` strings. Fail-open is the right contract; failing open *silently* isn't.

**Fix:** one `console.warn` with the error message in the catch.

### 3. Single-weak-cue prompts lost their only path to the scholarly model — `lib/ai/modelRouter.ts:136` (CONFIRMED)

The stricter score is a deliberate, golden-pinned change for *routing* — but it had an undiscussed UI side effect. The escalate button in `AiAssistant.tsx` renders only when `recommendedUpgrade` is present, and `recommendedUpgrade` now requires score ≥ 2 or an LLM `complex` verdict. During a classifier outage (score-fallback), "Why did Paul write Romans?" (score 1) — which the old gate escalated — gets neither auto-escalation nor the offer button. A capability was silently removed rather than degraded.

**Fix options:** when the LLM says routine, hiding the offer is defensible; in score-fallback, offer the upgrade at score ≥ 1, or decouple manual escalation from `recommendedUpgrade` entirely.

### 4. Deep + pinned-scope semantic passes emit duplicate evidence and citations — `lib/ai/retrievalPlanner.ts:671` (CONFIRMED)

The scoped and corpus-wide passes have different plan keys, so the `seen` dedup never applies, and nothing dedups their *results*. "Verses about love in John 3" routed deep can emit two identical `#### John 3:16 (semantic hit)` ±2-window blocks (burning the 58KB evidence budget and skewing synthesis toward the duplicated verse) and two identical citation rows in the Citations panel and saved notes.

**Fix:** pass the scoped pass's hit references into the corpus-wide call for exclusion, or dedup sections/citations by reference in `runRetrievalPlan`.

### 5. Report-mode evals are now nondeterministic through the live classifier — `eval/runner.ts:116` (CONFIRMED)

In report mode the classifier's verdict decides `deep`, which changes the retrieval packet, which moves recall/precision — so the planned before/after `eval:report` headline comparison is confounded by classifier flapping (e.g. `routing-why-alone-default` judged complex on one run flips to a 10-hit corpus-wide pass and its precision collapses), and each report run spends ~26 extra classifier calls. Mirroring production is a defensible design, but the report should make routing variance legible.

**Fix options:** surface per-item `routerSource`/`deep` deltas prominently in the before/after comparison, or pin routing to the deterministic score for metric computation and report the LLM verdict alongside. **Decide before the before/after `eval:report` run** — it confounds exactly that comparison.

### 6. Every live request pays up to 2s of serialized classifier latency before retrieval starts — `lib/ai/assistant.ts:68` (CONFIRMED)

Route-before-retrieve is the point of the branch, but the cost lands on trivial lookups too: "What does John 3:16 say?" stalls behind the classifier, and on the timeout path the user pays the full 2s *and* gets only score-fallback routing.

**Future optimization (not a blocker):** kick off standard-depth retrieval concurrently with routing and top up with the deep passes only when routing returns scholarly — the deterministic plan doesn't depend on the verdict, only the cap and extra semantic passes do.

### 7. Routing fields hand-restated in four parallel type declarations — `lib/ai/assistant.ts:158` (CONFIRMED)

`RoutingDecision`'s seven fields are hand-restated in `AssistantAnswer`, `WithMarkdownInput`, and `AssistantMessageMetadata` — this branch had to touch four parallel declarations, and the next routing field can silently drop from one with no type error (exactly the drift class the handoff flags as a top review focus).

**Fix:** intersect the type: `type AssistantAnswer = RoutingDecision & {...}`.

### 8. `inputItems as any` on the classifier payload — `lib/ai/complexity.ts:112` (CONFIRMED)

Disables all type checking on the classifier request payload; openai 4.104 exports `OpenAI.Responses.ResponseInput`. Typing it removes the cast and the eslint-disable, and prevents a future malformed payload from becoming a silent permanent score-fallback via finding 2.

### 9. Legacy cookie never expired, so the migration surface can never be retired — `components/AiAssistant.tsx:73` (CONFIRMED)

The migration writes the new cookie but never expires `textlab-assistant-auto-scholarly`, so the "remove after one release" plan has no completion mechanism — `app/assistant/page.tsx`'s dual-read, `parseAutoScholarly`, and `resolveConfirmScholarly`'s legacy arm must live forever.

**Fix:** expire the legacy cookie in the same migration effect.

### 10. `recommendScholarlyUpgrade` is production-dead with divergent semantics — `lib/ai/modelRouter.ts:66` (CONFIRMED)

Only its own unit tests call it (the router deliberately inlines the literal), and its score-only semantics diverge from the router's LLM-aware decision — a future caller reaching for the conveniently named helper reintroduces the exact bug the inlining avoided (re-deriving `complex` from the score discards an LLM verdict).

**Fix:** delete it (and its describe-block), or refactor it to accept the already-computed `complex` boolean.

---

## Refuted candidates (sanity-checking the handoff §9 triage)

- **Both deep-cap regression candidates** (`app/api/generated-study-notes/route.ts:23`) were independently refuted on the same grounds as the whole-branch review: `MAX_EVIDENCE_CHARS = 58_000` is unchanged and bounds embedded evidence regardless of call count; worst case is a graceful 413/400 on an explicit, authenticated save.
- **`extractSignals` re-derivation in `runWithJudge`** — pure/sync, identical input, no observable effect.
- **`semanticPasses` top-level duplication in `eval/report.ts`** — intentional and documented.

The §9 triage holds.

---

## The two §8 open decisions

### 1. 2000ms budget + smoke-test gate: keep 2000ms; gate the smoke on correctness (option 2 + a one-time prod-env confirmation from option 1)

Finding 6 is the strongest argument for the budget: the classifier is *serialized ahead of retrieval on every live request*, so 2000ms is already the ceiling of what users should absorb — widening it (option 3) makes every latency spike worse product-wide, and doing so because a Norton-TLS-intercepted dev box straddles the budget would be tuning a production constraint to a non-production artifact. The merge-blocker's purpose is validating the classifier *contract* (prompt, schema, verdicts, no 400s); dev-box latency is not signal.

**Recommendation:** change `scripts/smoke-classifier.ts` to exit 0 on all-correct verdicts, print timeouts as warnings with the latency distribution, and still hard-fail on wrong verdicts or API errors — then run it once in CI/a prod-like environment for the real latency datapoint before merge.

### 2. Deep-cap debt: agree, debt-not-blocker

The adversarial pass independently reached the same verdict (both cap candidates refuted). The failure mode is a graceful 413/400 on an explicit, authenticated, same-origin save; the 58KB evidence ceiling means deep mode redistributes the budget rather than raising it.

**One concrete hardening when the debt is paid:** the sizing invariant ("MAX_EVIDENCE_CHARS + fallback overhead fits the note caps") lives only in prose comments today — a verifier flagged it as unasserted. Add a unit test that computes the worst-case fallback answer size against `MAX_ANSWER`/`MAX_MARKDOWN` so the security-register entry can be closed with evidence.

---

## Recommended pre-merge scope

Findings 1–4 are worth fixing now (1 is mostly deletion + a doc correction; 2 is one log line; 3 is a small policy choice; 4 is a dedup). Finding 5 needs a decision before the before/after `eval:report` run. Findings 6–10 can ride along or be queued. The handoff's two open decisions both resolve without changing mandated constraints.

---

# Round 2: Follow-up review of the fix commits (2026-07-02)

**Fix range:** `dd2f2b3..ee0d5a0` (8 fix commits). Same method: 4 finders + independent verifier per candidate over the fix diff; 12 candidates verified, 7 survived, 1 refuted. All §5 binding constraints still hold.

**Scorecard on the 10 round-1 findings:** 1, 2, 3, 8, 9, 10 cleanly fixed · **4 fixed-but-regressed** (R2-1, R2-2 below) · **5 still open** (R2-3) · 6 deferred as recommended · **7 partially fixed** (R2-4).

## Remaining issues, most severe first

### R2-1. Corpus-wide pass excludes the pinned scope even when no scoped pass ran — `lib/ai/retrievalPlanner.ts:703` (CONFIRMED, regression from `4a1fa72`)

The scoped semantic pass is gated on `shouldRunSemantic(signals)`, but the corpus-wide pass passes `excludeScope: scope` **unconditionally**. When `shouldRunSemantic` is false (all-exact-verse or termless prompts), no semantic pass covers the pinned scope and the corpus-wide pass filters out everything in it. Deep prompt "Compare John 3:16 and John 13:34" → `shouldRunSemantic` false, scope `{book: "John"}` → every John hit excluded, so John 15:13 (the most relevant cross-reference) can never surface — while at `dd2f2b3`, before the fix, it did. The dedup fix became a coverage hole.

**Fix (one line):** `excludeScope: shouldRunSemantic(signals) ? scope : undefined`.

### R2-2. Fixed +5 over-fetch headroom can leave the corpus-wide pass with zero survivors — `lib/ai/retrievalPlanner.ts:574` (CONFIRMED)

`fetchLimit = limit + SEMANTIC_HIT_LIMIT` fetches 10, then filter-and-slice with no backfill. On a scope-dominated topic ("verses about the good shepherd in John", pinned to John) all 10 reranked hits can fall in-scope → 0 cross-text survivors, contradicting the comment's "always contributes cross-text hits" guarantee — and the trace still records a successful corpus-wide pass, misleading debugging.

**Fix options:** raise the headroom (e.g. `limit * 3`), push the exclusion into the semantic query itself, or record a shortfall marker in the trace when survivors < limit.

### R2-3. Round-1 finding 5 (report-mode eval nondeterminism) neither fixed nor recorded as deferred (CONFIRMED)

No commit in the fix range touches `eval/`, and no doc records a decision. The recommendation stands: decide **before** the before/after `eval:report` run — classifier flapping confounds exactly that comparison (plus ~26 extra classifier calls per run). Even a one-paragraph "accepted: report mirrors prod; variance is legible via per-item `routerSource`" note in the handoff/spec would close this as a deliberate deferral.

> **Resolved 2026-07-02 (decision, no code change):** report-mode routing stays live (the report's mandate is to monitor the real production pipeline); the deferral and a headline-comparison protocol (run the "after" report twice, diff per-item `routerSource`/`deep`, annotate/exclude any flapping item) are now recorded in the design spec's Testing & evaluation section.

### R2-4. Round-1 finding 7 only partially fixed; the new comment overclaims — `lib/ai/assistant.ts:27` (CONFIRMED)

`AssistantAnswer` and `WithMarkdownInput` now intersect `RoutingDecision`, but `AssistantMessageMetadata` in `lib/ai/sessions.ts` still hand-restates all seven routing fields and `finishAssistantExchange` builds the literal field-by-field — the next routing field silently vanishes from persisted session metadata while the comment claims the drift class "can never" happen. Intersect the metadata type with `RoutingDecision` (or spread the routing fields), or soften the comment.

### R2-5. Legacy cookie expiry removes rollback safety — `components/AiAssistant.tsx:87` (PLAUSIBLE)

Expiring `textlab-assistant-auto-scholarly` implements round-1 finding 9, but destroys the only copy the *previous* release can read: one page load on the new release then a rollback, and the old bundle silently loses the user's saved preference. Genuine tradeoff between retiring the migration and rollback safety — consciously accept it (single low-stakes preference, self-healing on next toggle) or delay the expiry one release; it deserves a deliberate call.

> **Resolved 2026-07-02 (decision, no code change):** tradeoff accepted — the failure mode is a low-stakes preference reverting to the default until re-toggled, and the expiry is what lets the dual-read be deleted next release. The acceptance is now recorded in the code comment at the `expirePrefCookie` call.

### R2-6. `isTimeout` regex over-broad — `scripts/smoke-classifier.ts:33` (CONFIRMED, diagnostics-only)

`/timed out|timeout/i` misclassifies e.g. a gateway 504 reading "upstream request timeout" as a budget timeout, routing it to the relaxed probe and mislabeling a hard API problem as a latency datapoint. The gate still fails correctly; only the operator guidance is wrong. Narrow to the SDK's typed error / `err.name` check.

### R2-7. `PROD_BUDGET_MS` re-hardcodes 2000 — `scripts/smoke-classifier.ts:28` (PLAUSIBLE)

If `ROUTER_TIMEOUT_MS` is ever tuned, the merge-blocking smoke silently probes at a stale budget. Export the constant from `lib/ai/complexity.ts` and import it (the script already imports from that module).

**Refuted:** the `modelUsed === "none"` sentinel coupling between `AiAssistant.tsx` and `lib/ai/assistant.ts` — the literals agree today and there is no constructible runtime failure (a shared constant would still be tidier).

## Recommended scope for round 3

R2-1 is the one real must-fix (a one-line coverage regression on the deep path). R2-2 and R2-4 are small, worth folding into the same commit. R2-3 needs a decision (code or a documented deferral) before the `eval:report` comparison run — **decided 2026-07-02, see R2-3 resolution note**. R2-5 needs a deliberate accept/delay call — **accepted 2026-07-02, see R2-5 resolution note**. R2-6/R2-7 are polish.

---

# Round 3: Fix verification (2026-07-02)

**Fix range:** `ee0d5a0..8e77801` (4 commits). Verified by direct diff read against each round-2 finding, plus `tsc --noEmit` clean and 121 passing unit tests across the planner/complexity/router suites.

- **R2-1 fixed** (`d9b4e32`): `excludeScope: scopedRan ? scope : undefined` — exclusion applies only when the scoped pass actually ran, exactly the recommended fix; regression test added.
- **R2-2 fixed** (`d9b4e32`): over-fetch raised to `limit * 3`; the "always contributes cross-text hits" overclaim removed from the comment (a scope-dominated topic may still yield fewer — now stated honestly).
- **R2-3 resolved by decision** (`8e77801` + spec edit): report-mode routing stays live; double-run headline protocol recorded under Testing & evaluation → Eval report in the design spec.
- **R2-4 fixed** (`43b9ca2`): `AssistantMessageMetadata` intersects `RoutingDecision` — the last parallel routing declaration is closed.
- **R2-5 resolved by decision**: expiry tradeoff accepted; rationale recorded in the code comment at the `expirePrefCookie` call.
- **R2-6 fixed** (`2b46b6c`): `isTimeout` narrowed to the SDK's typed error name + `/request timed out/i`.
- **R2-7 fixed** (`2b46b6c`): `ROUTER_TIMEOUT_MS` exported from `lib/ai/complexity.ts` and imported by the smoke script.

**No open findings remain.** Outstanding pre-merge work is operational, not review: the smoke run in a prod-like environment (per the round-1 §8.1 recommendation), the acceptance suite, and the double-run before/after `eval:report`.

---

# Pre-merge verification results (2026-07-02)

All operational checks are complete.

## Acceptance suite: PASS

All 13 interactions green against the Neon test branch, including the branch-touched paths (assistant retrieval-first answer + trace + citations, non-live `modelUsed: "none"` assertion, topical/semantic prompt, generated-study-note save). Pinned corpus counts unchanged (40 λόγος hits).

## Classifier smoke: PASS — and it changed a mandated constraint

- **Local** (TLS-intercepted box): 4/4 verdicts correct, 0 API errors; all calls initially over the 2000 ms budget.
- **Prod-like** (GitHub Actions run 28575290108, clean network): 4/4 verdicts correct — but **3 of 4 calls exceeded 2000 ms** (observed 1.7–3.2 s), killing the "dev-box TLS is the anomaly" hypothesis. At 2000 ms production would usually pay the full timeout AND fall back to the score — worst point on the tradeoff curve.
- **Consequence:** `ROUTER_TIMEOUT_MS` widened 2000 → 3000 ms (`14ea1a1`), revising the round-1 §8.1 "keep 2000 ms" recommendation on new evidence. Spec/README/PROJECT_STATE synced; local rerun at 3000 ms: 3/4 within budget even behind TLS interception. Queued follow-up: run standard-depth retrieval concurrently with routing and top up on a scholarly verdict, making the budget mostly free in wall-clock terms.

## Before/after `eval:report` headline numbers

Shared 20 golden items, both pipelines fully healthy end-to-end. Before = `main` (4ebf793) run locally with `EVAL_JUDGE_TIMEOUT_MS=90000`; after = branch (`01842f4`) on CI (run 28597720323, 25/26 synthesized, 25 judged, rerank applied on 16). Venue asymmetry forced by the CI finding below; disclosed per protocol.

| | recall | precision | faithfulness |
|---|---|---|---|
| before (main) | 0.975 | 0.467 | 0.833 (20 judged) |
| after (branch) | **0.975** | 0.465 | 0.851 (19 judged) |

- **Retrieval-neutral on the existing golden set:** recall identical; precision −0.002. Only 2 of 20 shared items changed at all — both LLM-routed scholarly/deep: `reconciliation-conceptual` (precision 0.17→0.13 from the corpus-wide semantic hits; recall still 1.00) and `justification-faith-conceptual` (retrieval unchanged; faithfulness 0.67→1.00).
- The 6 new routing items all matched their score `expectedRouting`; 5 items routed deep in the after run.
- **No flap exclusions needed:** all run-to-run routing differences were classifier-*timeout* fallbacks, never verdict changes — across every double-run performed (2 local + CI), the LLM's verdicts were 100% consistent whenever the call completed.
- Known live-mode override (documented in schema/golden set): the LLM consistently routes `routing-why-alone-default` scholarly; the gate's score assertion is unaffected.

## Operational finding (pre-existing, NOT this branch): main's weekly eval report has been silently broken since ≥ June 26

Four consecutive CI runs from `main` (June 26 scheduled run 28232195887 + three dispatches 2026-07-02) failed **every** OpenAI call with `Premature close` — synthesis 0/20, judge 0/20, semantic retrieval dead — while the workflow stayed green because `eval:report` is deliberately non-blocking. The June 26 report's stored numbers (recall 0.852 / precision 0.464) are deterministic-only retrieval, not the hybrid pipeline. Same secrets/workflow succeeded on the branch's second CI attempt, so this is flaky Actions↔OpenAI connectivity, not keys or code. **Follow-up (separate from this branch):** add a health check to `weekly-eval-report.yml` — fail or prominently annotate the run when zero items reach `synthesisStatus: "ran"` — so a degraded report can never sit green for weeks again.
