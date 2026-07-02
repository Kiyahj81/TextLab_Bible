# Review Handoff: LLM Complexity Router + Deep Retrieval

**For:** an independent reviewer (Fable 5) of the unmerged `feat/assistant-llm-router-deep-retrieval` branch.
**Your job:** give an informed, adversarial code + design review. This branch has already been through 11 per-task reviews and one whole-branch review (all clean / "ready to merge"), so the low-hanging fruit is gone — look for cross-cutting correctness bugs, egress/safety regressions, and whether the two open decisions below are handled correctly. Challenge the design where you disagree; nothing here is sacred.

> This note is a point-in-time review aid; it can be dropped before merge if it shouldn't live in the branch's permanent history.

---

## 1. What the feature does (one paragraph)

TextLab Bible has a retrieval-first AI study assistant. Previously it retrieved evidence, then routed the prompt to a model (default vs. "scholarly"), and only escalated to scholarly on explicit user request or a crude OR-gate of regex cues. This branch (a) adds an **LLM complexity classifier** (with a deterministic weighted-score fallback) that decides whether a question needs the scholarly model, (b) **auto-escalates** complex questions to scholarly **by default** (the UI toggle is now an *ask-first* opt-out), and (c) **reorders the pipeline to route → retrieve** so that scholarly routing turns on **"deep" retrieval** (wider evidence gathering) rather than only swapping the synthesis model.

## 2. How to pull the code under review

- Branch: `feat/assistant-llm-router-deep-retrieval` (not merged, not pushed).
- Implementation diff (11 commits): `git diff b6edb5e..dd2f2b3` (everything below `b6edb5e` is the spec/plan markdown, already reviewed — out of scope).
- **Authoritative sources of intent** (read these for the "should"):
  - Spec: `docs/superpowers/specs/2026-07-01-llm-router-deep-retrieval-design.md`
  - Plan: `docs/superpowers/plans/2026-07-01-llm-router-deep-retrieval.md`
- Key source files: `lib/ai/complexity.ts` (new), `lib/ai/modelRouter.ts`, `lib/ai/assistant.ts`, `lib/ai/retrievalPlanner.ts`, `lib/ai/sessions.ts`, `app/api/assistant/route.ts`, `components/AiAssistant.tsx`, `lib/readerPrefs.ts`, `eval/runner.ts`, `eval/gate.ts`, `eval/dataset/golden-set.json`, `scripts/smoke-classifier.ts`.

## 3. Architecture / data flow (after this branch)

```
answerBibleQuestion(prompt, { escalate?, confirmEscalation? })   // lib/ai/assistant.ts
  ├─ extractSignals(prompt)
  ├─ if !isLiveAssistantEnabled():           // production non-live / no-key path
  │     retrieve { semanticEnabled:false }    // NO routing, NO classifier, NO embeddings
  │     return fallback { modelUsed:"none", routerSource:"none", deep:false }
  ├─ routing = await routeAssistantPrompt(prompt, { escalate, confirmEscalation, signals, live:true })
  │     ├─ escalate:true  → { scholarly, deep:true, routerSource:"manual" }  (no classifier call)
  │     ├─ live:true      → classifyComplexityLLM()  → routerSource:"llm"
  │     │                    on ANY throw → scoreComplexity() → routerSource:"score-fallback"
  │     ├─ complex && !confirmEscalation → { scholarly, deep:true }   (auto-escalate)
  │     └─ complex &&  confirmEscalation → { default,  deep:false, recommendedUpgrade:{scholarly} }
  ├─ evidence = await runRetrievalPlan(signals, prompt, { semanticEnabled:true, deep: routing.deep })
  │     └─ deep:true → deterministic cap 8→12; + corpus-wide semantic pass (ignores shouldRunSemantic)
  ├─ synthesizeWithRefinement → verifyGrounding (Silence Protocol) → withMarkdown(...routing)
  └─ AssistantAnswer gains { deep, routerSource, complexityScore }; persisted in session metadata
```

`complexity.ts` owns both strategies:
- `scoreComplexity(prompt, signals?)` — weighted regex/signal score, **threshold 2**. Strong cues (comparison intent, ≥2 distinct books, a scholarly cue word, "how can X and Y") weigh 2 (escalate alone); weak cues (why-framing, ≥3 concept words, >30 words) weigh 1 (need a partner). Concept count comes from `detectConceptWords` (frozen base stoplist), deliberately NOT `signals.topicWords` (search-tunable) so search tuning can't move routing.
- `classifyComplexityLLM(prompt, signals?)` — OpenAI **Responses API**, model `OPENAI_ROUTER_MODEL` (default `gpt-5-mini`), strict JSON-schema output + zod re-validation, `reasoning:{effort:"low"}`, no `temperature`, per-request `{ timeout:2000, maxRetries:0 }`. **Throws on any failure** (no client / timeout / API error / bad JSON); it never falls back itself — the router catches and degrades to `scoreComplexity`.

## 4. Task-by-task summary (11 commits, b6edb5e..dd2f2b3)

1. `e679473` — `scoreComplexity` weighted score (threshold 2).
2. `4aff196` — `classifyComplexityLLM` via Responses API (throws-on-failure contract).
3. `4616663` — `routeAssistantPrompt` made async; structured fields `deep`/`routerSource`/`complexityScore`; old OR-gate regexes deleted (moved to complexity.ts); score-fallback on classifier throw.
4. `feb86c3` — deep retrieval mode in `runRetrievalPlan` (cap 8→12 + corpus-wide semantic pass; options object `{ semanticEnabled?, deep? }`).
5. `d0742eb` — pipeline reorder: route BEFORE retrieve so `routing.deep` widens retrieval; `AssistantAnswer` gains the 3 fields.
6. `348acfe` — persist `deep`/`routerSource`/`complexityScore` in session message metadata.
7. `1dd05d8` — API: `confirmEscalation` param; deprecated `autoEscalate` mapping (`autoEscalate:false → confirmEscalation:true`); removed a temporary compat shim.
8. `31e571a` — UI: ask-first toggle ("Ask before using the scholarly model when a question looks complex") sends `confirmEscalation`; legacy `auto-scholarly` cookie migration.
9. `130d849` — eval: golden items gain `expectedRouting`; runner routes before retrieval (mirrors prod); gate asserts per-item routing; `semanticPassesFrom` (per-pass array) replaces `.find()`.
10. `9042e31` — `scripts/smoke-classifier.ts` + `smoke:classifier` npm script (live pre-merge smoke test) + `.env.example` doc.
11. `dd2f2b3` — docs: README, PROJECT_STATE, security-register (deep-cap hardening debt), route.ts comment sync, one golden-set note fix.

## 5. Binding constraints (verify these hold — regressions here are the highest-severity)

- **Production non-live never routes.** When `isLiveAssistantEnabled()` is false → deterministic fallback, `modelUsed:"none"`, `routerSource:"none"`, `deep:false`; **no** router/classifier/embedding call.
- **`deep === (modelRole === "scholarly")`** in every routing return path.
- **Classifier per-request overrides mandatory:** `{ timeout:2000, maxRetries:0 }` (shared client is 120s/1-retry); `reasoning:{effort:"low"}` (pinned openai 4.104 forbids `"minimal"`); no `temperature`.
- **Deep retrieval:** deterministic cap 8 (standard) / 12 (deep); semantic passes added AFTER the slice (not counted in the cap); `semanticEnabled:false` suppresses ALL passes; the corpus-wide deep pass ignores `shouldRunSemantic`, the scoped pass respects it.
- **Safety budgets untouched:** `MAX_EVIDENCE_CHARS` (58000), `maxEnrichChars()`, `MAX_WORD_SAMPLE`, citation caps, "degrade never drop" enrichment.
- **API migration:** `confirmEscalation` = ask-first opt-out; deprecated `autoEscalate===false` → `confirmEscalation:true` (`??` gives an explicit `confirmEscalation` precedence). `autoEscalate` is no longer an option on `answerBibleQuestion`.
- **Cookie migration** (`resolveConfirmScholarly`): new confirm cookie wins; legacy `"0"` (old explicit opt-out of auto) → `true` (confirm-first); legacy `"1"`/absent → `false` (new auto default). Net effect: a legacy auto-ON user lands on the new auto default (experience preserved).
- **Eval:** golden refs are canonical short forms (`Rom`, `Gal`, `1Cor`, `Jas`); gate mode is key-free (`live = semanticEnabled && isLiveAssistantEnabled()`, so gate never calls the classifier); never lower eval thresholds.
- Coverage gate: v8 over `app/api/**` + `lib/**` at 80/80/75/65.

## 6. Non-obvious design decisions & rationale (challenge if you disagree)

- **Score fallback is intentionally STRICTER than the old OR-gate.** The old gate escalated on any single weak cue (e.g. bare "Why did Paul write Romans?"). The new weighted score requires ≥2, so solo weak cues now stay `default`. This is a deliberate behavior change (the LLM classifier is meant to catch the subtle interpretive cases the score can't). Golden items `routing-why-alone-default` / `routing-concept-density-default` / `routing-topic-survey-default` pin this.
- **The router inlines the `recommendedUpgrade` literal** instead of calling `recommendScholarlyUpgrade`. Deliberate: the helper re-derives `complex` from the *score*, which would discard an LLM verdict when `routerSource==="llm"`.
- **Deep mode adds a corpus-wide pass rather than raising the scoped limit.** Raising limits within a pinned scope can't supply cross-text evidence, which is exactly what deep/interpretive questions need. The corpus-wide pass ignores `shouldRunSemantic` because deep interpretive prompts often have no extractable topic words.
- **`autoEscalate` is accepted-but-deprecated at the API** (not dropped) so pre-existing clients that sent an explicit `autoEscalate:false` opt-out keep opting out under the new auto-default semantics.

## 7. Verification status (all local checks green)

- `npm run verify` (lint 0-warn + tsc + build + coverage): **PASS**. Coverage 90.84% stmts / 84.28% branches / 91.15% funcs / 93.85% lines (gate 80/80/75/65). New files: `modelRouter.ts` 100/97.82, `complexity.ts` 97.56/96.55, `assistant.ts` 100/86.66, `retrievalPlanner.ts` 97.88/90.51.
- `npm run eval:gate`: **26/26** (= 1 citation + 1 lemma + 18 type-gated + **6 routing** checks; count reconciles exactly), citation resolvability 100%. (The 6 routing checks pass silently — the script prints per-item checks only on failure.)
- `npm run test:integration`: **37/37** across 7 files.
- Not yet run (pending go-ahead): `test:acceptance` (Playwright), and the before/after `eval:report` for PR headline numbers (needs `OPENAI_API_KEY` + `AI_GATEWAY_API_KEY`).

## 8. Open decisions needing a human call (worth your opinion)

1. **Live smoke test (`smoke:classifier`) — a spec merge-blocker — does not cleanly pass locally.** The classifier's *verdicts* are all correct (10/10 completed calls, no 400s, no misclassifications), but real `gpt-5-mini` (reasoning "low") latency on the dev box is ~1.6–2.4s, straddling the **mandated** 2000ms/no-retry budget, so ~half the calls hit `Request timed out` at ~2000–2024ms. Likely cause: this machine runs behind Norton TLS interception (`--use-system-ca`), adding per-connection overhead a Vercel/prod path wouldn't have. In production a timeout is not a failure — the router gracefully falls back to the deterministic score. Three options are on the table: **(1)** keep the mandated 2000ms and confirm the smoke run in a prod-like env/CI before merge (chosen provisionally, changes nothing); **(2)** make the smoke script correctness-focused (exit 0 on correct verdicts, print timeouts as warnings; still hard-fail on 400s/wrong verdicts); **(3)** widen `ROUTER_TIMEOUT_MS` (e.g. 2500–3000ms), which changes a mandated constraint + a Task-2 test assertion. **Question for you:** is 2000ms the right production budget, and should the merge-blocker gate correctness or correctness+latency?
2. **Deep-mode body-cap hardening debt** (logged in `docs/security-register.md`, entry "generated-study-notes … 256 KB"). Deep routing raises the planner ceiling 8→12 + a corpus-wide semantic pass. The `generated-study-notes` POST endpoint persists a client-submitted assistant answer/markdown with size caps sized to the old 8-call worst case (~57KB answer / ~58KB markdown / ~167KB body). A deterministic-fallback answer produced on the *live-scholarly* path (deep evidence, only when synthesis fails) could be larger. **Mitigating fact:** `MAX_EVIDENCE_CHARS=58000` still bounds embedded evidence regardless of call count, so deep mode redistributes the same 58KB budget across more sections rather than raising the ceiling — worst case is a graceful 413/400 on an explicit, auth+same-origin save, not unbounded growth. Logged as tracked debt (re-measure/resize before treating deep as fully hardened); the whole-branch review judged it not a merge blocker. **Question for you:** agree it's debt-not-blocker, or should the caps be re-measured now?

## 9. Known Minor findings (already triaged as acceptable — sanity-check the triage)

- `scoreComplexity("")` (empty prompt) has no dedicated test (behavior defined: score 0).
- `classifyComplexityLLM`: the `output_text ?? ""` empty-alternative and non-empty `references` context branch are unexercised; `reason` is only structurally validated (inherent to LLM classifiers).
- Task 7: no test pins the both-flags-present conflict (`confirmEscalation` should win via `??`) — correct by inspection; new route cases don't assert HTTP 200.
- `runWithJudge` (eval) calls `extractSignals` a second time (for `intent`, which `RoutingDecision` doesn't carry) — pure/sync, no egress; a DRY nit.
- `recommendScholarlyUpgrade` is now production-dead (only used by tests; the router inlines its literal).

## 10. Suggested review focus (be adversarial here)

- **Egress under the no-key/non-live contract.** Trace every path where the classifier or embeddings could fire when `isLiveAssistantEnabled()` is false or in eval gate mode. This is the highest-severity class.
- **`deep` end-to-end integrity:** router → `answerBibleQuestion` → `runRetrievalPlan` → persistence → eval. Any place `deep`/`routerSource`/`complexityScore` gets dropped or mislabeled.
- **Deep scope policy** in `retrievalPlanner.ts`: does the corpus-wide pass truly ignore `shouldRunSemantic` while the scoped pass respects it? Is `semanticEnabled:false` a hard off-switch for all passes? Are semantic passes really outside the 8/12 cap?
- **The `confirmEscalation`/`autoEscalate` mapping** and the **cookie migration** — both invert prior semantics; verify each truth-table row.
- **Score math** for the 6 golden routing items vs. the actual `scoreComplexity` implementation (the golden `notes` are descriptive, not asserted — the `expectedRouting` value is what's gated).
- Whether the **2000ms timeout** and the **deep-cap** decisions (§8) are the right calls.
