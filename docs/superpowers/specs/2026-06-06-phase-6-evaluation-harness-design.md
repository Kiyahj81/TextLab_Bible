# Phase 6 — Evaluation Harness Design

*Milestone 3, Phase 6 (final phase). Date: 2026-06-06. Revised after external review (Codex).*

## Purpose

Phases 1–5 built the retrieval-first, grounded NT-exegesis assistant pipeline
(deterministic retrieval → semantic/hybrid + RRF → Voyage rerank → Louw-Nida →
synthesis → grounding verification). Phase 6 is the **quality gate** over that
pipeline: an automated, repeatable way to catch regressions as the pipeline is
later touched.

The top priority for this Bible-study app is preventing **citation-shaped
hallucinations** (invented or misattributed scripture). Phase 6 is therefore
**explicitly two-tier** — and the two tiers measure different things, because in
this codebase a fast, key-free, deterministic gate *cannot* exercise the hybrid
vector pipeline or detect generative hallucination (see "Why two tiers" below):

- **Blocking PR gate — a deterministic, DB-only regression gate.** Fast, free,
  100% deterministic, no API key. It protects **deterministic evidence
  retrieval and citation safety**: Context Precision/Recall over the
  deterministic retrieval paths (FTS / lemma / passage / domain), required
  lemma/domain coverage, and 100% **citation resolvability**.
- **Non-blocking hybrid quality report — the full live pipeline.** Run
  nightly / on-demand. It exercises the *true* hybrid pipeline (query
  embeddings, pgvector KNN, RRF, Voyage rerank, synthesis) and adds an
  LLM-as-judge faithfulness score. It records API / model / rerank status, and
  failures are **investigation signals, not PR blockers**. Nondeterminism and
  API cost are acceptable here because it never blocks CI.

This matches the deterministic-gate / fuzzy-dashboard split decided during
brainstorming.

### Why two tiers (the constraint that forces this)

The blocking gate must run with **no API key and no network beyond the DB**.
Three facts in the current code make a key-free deterministic gate unable to be
a "hybrid-pipeline quality gate":

1. `runRetrievalPlan(signals, prompt, semanticEnabled=false)` skips the semantic
   call entirely (`lib/ai/retrievalPlanner.ts` — `if (semanticEnabled && …)`),
   so the gate exercises only the deterministic paths.
2. Even with `semanticEnabled=true`, `embedQuery` returns `null` without an
   OpenAI client (`lib/search.ts`), so vector KNN produces nothing without a key.
3. `rerankCandidates` returns `null` without `AI_GATEWAY_API_KEY`
   (`lib/search/rerank.ts`), so rerank is a no-op without a key.

And the deterministic *fallback* answer embeds retrieved evidence **verbatim**
(`buildDeterministicFallback`), so it cannot produce a citation-shaped
hallucination by construction — there is no generative prose for the gate to
catch. Generative hallucination only exists on the **live synthesis** path,
which is nondeterministic and key-dependent.

Conclusion (the locked design decision): **the PR gate protects deterministic
evidence retrieval and citation safety; the report monitors full hybrid-pipeline
quality.** We do not pretend the gate tests the hybrid pipeline or detects
generative hallucination.

## Scope

**In scope:**
- A standalone `eval/` layer that drives the existing pipeline against a curated
  golden dataset and scores the results.
- A ~20-item hand-curated golden dataset spanning all five query types.
- **Deterministic gate metrics:** Context Precision, Context Recall, required
  lemma/domain coverage, and Citation Resolvability — all computed from the
  deterministic (`semanticEnabled=false`) retrieval output.
- A deterministic blocking gate (`npm run eval:gate`) with tunable thresholds.
- A nightly/on-demand run (`npm run eval:report`) that runs the **full hybrid
  pipeline once per question**, reports hybrid Context Precision/Recall, adds
  LLM-judge faithfulness (via the Vercel AI Gateway), and writes a self-contained
  HTML report (+ JSON dump). Records API/model/rerank status per question.
- Unit and integration tests for the harness itself.
- Docs updates (README, PROJECT_STATE, roadmap).

**Out of scope:**
- **Prose-sweep grounding hardening** (PROJECT_STATE.md — verifying inline prose
  references, not just declared `claims[]`). That is a change to the grounding
  *verifier*, not the eval harness; it stays a separate follow-up.
- Any change to the runtime retrieval/synthesis/grounding pipeline. Phase 6 only
  *measures* the existing pipeline — no schema changes, no behavior changes.
  (Adding a faithfulness LLM judge in `eval/` is new code in `eval/`, not a
  pipeline change.)
- Deterministic fixtures for query embeddings / rerank (would let the gate replay
  the hybrid pipeline key-free; explicitly rejected for v1 in favor of the
  two-tier split — hybrid quality is tracked nightly instead).
- Auto-derived / generated questions (the dataset schema allows it later; v1 is
  hand-curated only).
- Raising the branch coverage gate (tracked separately).

## Non-goals / guardrails

- The blocking gate MUST NOT require an API key or any network beyond the
  database. It runs against the Neon test branch already wired via `.env.test`.
- The LLM judge MUST NOT be in the release-blocking path (it is itself
  hallucination-prone and nondeterministic).
- `eval/` is a leaf: it imports from `lib/**` but nothing in `lib/**` or
  `app/**` imports from `eval/`, so it cannot affect runtime behavior.

## Architecture

```
golden dataset (committed JSON)
        │
        ▼
  eval runner ──────────────────────────────────────────────┐
        │                                                     │
   GATE mode (deterministic)              REPORT mode (live, one packet/question)
   runRetrievalPlan(…, semantic=false)    runRetrievalPlan(…, semantic=true)  ← single packet
        │                                  │       │
   metrics + resolvability           hybrid metrics + resolvability
        │                                  │       └─ synthesizeWithRefinement(packet) → answer
        ▼                                  │                     │
   eval:gate → exit code             │              judgeFaithfulness(answer, packet)
   (precision/recall/coverage/             │                     │
    resolvability thresholds)              ▼                     ▼
                                     HTML + JSON report (scorecard, golden-vs-retrieved,
                                     trace incl. rerank status, faithfulness verdicts)
```

The gate and the report run the **same runner module**, but in two distinct
modes that each use **exactly one `EvidencePacket`** so metrics and (in report
mode) the judged answer are always derived from the same retrieval — never two
separate runs.

## File layout

```
eval/
  dataset/
    golden-set.json            # ~20 curated questions + golden refs (committed)
    schema.ts                  # types + a zod validator for the dataset
  thresholds.ts                # gate threshold constants (single source of truth)
  references.ts                # canonicalizeReference + set helpers (via lib/references)
  metrics.ts                   # contextPrecision, contextRecall, aggregation
  runner.ts                    # runDeterministic / runWithJudge → RunResult (one packet each)
  judge.ts                     # LLM-as-judge faithfulness via Vercel AI Gateway (key-gated)
  report.ts                    # RunResult[] → static HTML + JSON
  output/                      # gitignored: report.html, report.json
scripts/
  eval-gate.ts                 # npm run eval:gate   — deterministic, exit code
  eval-report.ts               # npm run eval:report — full hybrid run + HTML/JSON
tests/unit/eval/               # metrics, dataset validity, thresholds, report
tests/integration/eval-runner.test.ts  # one-question end-to-end smoke
```

## The golden dataset

Each item exercises one pipeline path:

```jsonc
{
  "id": "agape-1cor13",
  "question": "What does ἀγάπη mean in 1 Corinthians 13?",
  "queryType": "lemma-survey",        // exact-verse | lemma-survey | conceptual | domain | cross-chapter
  "goldenReferences": ["1Cor 13:1", "1Cor 13:2", "..."],  // refs that SHOULD be retrieved
  "mustContainLemma": "ἀγάπη",        // optional: retrieval must surface this lemma (gated)
  "notes": "Tests lemma survey within a single chapter"
}
```

- **`goldenReferences`** drive Context Precision/Recall. Stored in the codebase's
  canonical reference form (`<osisId> <chapter>:<verse>`, e.g. `1Cor 13:1`,
  matching `formatReference`/`parseReference` in `lib/references.ts`) and
  re-normalized via `parseReference` before comparison.
- **`queryType`** groups report results and lets a test assert coverage across
  all five pipeline paths.
- **`mustContainLemma`** (optional) — when present, retrieval must surface this
  Greek lemma somewhere in the assembled evidence. Enforced by the gate (see
  Coverage below), not merely recorded.
- No "golden answer" prose is stored. Faithfulness is judged against *retrieved
  evidence* (the RAGAS definition), not a fixed expected answer.
- The ~20 items split across the five query types. The exact questions are
  drafted during implementation and submitted for maintainer review before
  thresholds are calibrated.

## Metrics

References are normalized to canonical `<osisId> <chapter>:<verse>` form (via
`lib/references.ts`) before any set comparison. Both tiers compare against the
`EvidencePacket` citations that `runRetrievalPlan` actually produces — the gate
against the deterministic packet, the report against the hybrid packet.

**Context Precision** — of the references retrieved, what fraction are golden?
`precision = |retrieved ∩ golden| / |retrieved|`. `1.0` when both empty; `0.0`
when retrieved is empty but golden is non-empty.

**Context Recall** — of the golden references, what fraction were retrieved?
`recall = |retrieved ∩ golden| / |golden|`. `1.0` when golden is empty. The most
important metric for a Bible app: a missed verse means incomplete evidence.

**Required lemma/domain coverage** — for items with `mustContainLemma`, the
assembled evidence must contain that lemma. The gate requires **100%** coverage
over the items that declare a requirement, so a lemma-survey regression that
still happens to match verse refs is still caught.

**Citation Resolvability** (gate; renamed from "grounding pass-rate") — every
reference emitted by deterministic retrieval must **parse and resolve to a real
SBLGNT verse**. Computed by running `verifyGrounding` over reference-only claims
(`greekQuote: null`), which in this configuration verifies reference resolution.
Required at **100%**.

> **What citation resolvability does NOT claim:** it does not verify answer prose
> or quote support, and it is **not** a hallucination metric. Because the
> deterministic fallback embeds retrieved evidence verbatim, there is no
> generative prose to check. Live-answer grounding remains enforced by the
> production runtime verifier (`verifyGrounding` on live synthesis, which refuses
> ungrounded answers) and is monitored in the nightly quality report.

**Faithfulness (report only)** — LLM-as-judge decomposes the *live* synthesized
answer into atomic claims and rules each supported / unsupported against the
retrieved evidence. Score = supported / total. Routed through the **Vercel AI
Gateway** (model `EVAL_JUDGE_MODEL`, default `anthropic/claude-sonnet-4-6`), gated
on `AI_GATEWAY_API_KEY`. Absent key → skipped (recorded `null`), never failed.

## Gate thresholds

`npm run eval:gate` runs deterministically (DB only) and exits non-zero if **any**
aggregate check fails. Constants live in `eval/thresholds.ts` (one source of
truth) and are asserted by a unit test (Finding 6: after calibration the test
asserts the **exact** values, so an accidental edit is itself caught — not just
bounds).

| Metric | Starting threshold | Rationale |
|---|---|---|
| Mean Context Recall | ≥ 0.90 | Don't silently start missing the right verses |
| Mean Context Precision | ≥ 0.80 | Some passage-window noise acceptable; recall matters more |
| Per-question recall floor | ≥ 0.50 | Catch a single catastrophically-broken query a healthy mean would hide |
| Required lemma/domain coverage | 100% | A lemma-survey regression must not pass on ref overlap alone |
| Citation Resolvability | 100% | Zero tolerance for a citation that doesn't resolve to a real verse |

These are **starting** values, calibrated against the first real run (after the
dataset is reviewed) so the gate starts green, then ratcheted up.

## Execution model

- **PR / CI (blocking):** `npm run eval:gate` — needs only `DATABASE_URL` (Neon
  test branch via `.env.test`). Deterministic, fast, free; runs
  `runRetrievalPlan(…, semanticEnabled=false)`. A dedicated CI step alongside
  `test:integration` / `test:acceptance` — **not** folded into the DB-free
  `npm run verify`.
- **Nightly / on-demand (non-blocking):** `npm run eval:report` — runs the full
  hybrid pipeline (`semanticEnabled=true`) once per question, builds the live
  answer from that same packet via `synthesizeWithRefinement`, judges
  faithfulness via the AI Gateway, and writes `eval/output/report.{html,json}`.
  Degrades gracefully: no `OPENAI_API_KEY` → no live answer (faithfulness `null`,
  metrics reflect whatever retrieval produced); no `AI_GATEWAY_API_KEY` → no
  judge and no rerank. Records all three statuses per question.

## The HTML report

Single self-contained file (inline CSS, editorial-scholar palette). Structure:

- **Summary scorecard** — gate metrics + mean faithfulness, with pass/fail
  badges and the active thresholds; plus the run's API/model/rerank status so a
  reader knows whether the hybrid path and judge actually ran.
- **One card per question:**
  - Query text + `queryType` badge, overall pass/fail.
  - **Golden vs Retrieved references** side by side — golden refs ✓ hit / ✗
    missed; retrieved refs in-golden / extra-noise. The "why didn't my verse get
    retrieved" view.
  - **Retrieval trace** — each citation's `toolName` (the source: `searchSemantic`
    / `searchKeyword` / `searchLemma` / `getPassage` / `searchDomain`) in order,
    plus the `searchSemantic` tool-trace entry's **rerank status and candidate
    count** (Finding 5: per-hit RRF source and post-rerank rank position are not
    exposed by the current pipeline, so the report shows `toolName` + the trace's
    rerank status rather than promising rank provenance).
  - Lemma/domain coverage hit/miss for items that declare a requirement.
  - Faithfulness verdict (when judged) — each claim supported/unsupported + the
    judge's reason.

`eval/output/report.json` is written alongside. `eval/output/` is gitignored.

## Testing

- **Unit** (`tests/unit/eval/`):
  - `metrics.ts` — precision/recall math, normalization, empty-set edge cases.
  - dataset validity — `golden-set.json` parses against the zod schema; every
    `queryType` represented; all golden references parse via `lib/references.ts`.
  - `thresholds.ts` — sanity bounds (all in `[0,1]`, recall floor ≤ mean recall
    threshold; 100% metrics are exactly 1); after calibration, exact values.
  - `report.ts` — HTML/JSON render smoke (no live calls), HTML-escaping.
- **Integration** (`tests/integration/eval-runner.test.ts`): `runDeterministic`
  executes one question end-to-end against the Neon test branch and produces a
  well-formed `RunResult`. Skips itself when `DATABASE_URL` is unset (existing
  integration-suite convention).
- `eval/**` is included in lint + tsc. The harness is not itself part of the
  runtime coverage gate (`app/api/**` + `lib/**`).

## Documentation & housekeeping

Per CLAUDE.md:
- `README.md` — document `eval:gate` (deterministic blocking gate — what it
  protects) and `eval:report` (nightly hybrid quality report + judge), the
  golden-set location, and the `EVAL_JUDGE_MODEL` / key requirements.
- `docs/PROJECT_STATE.md` — mark Phase 6 done; describe the two tiers, the
  calibrated thresholds, the dashboard, the dataset; keep prose-sweep grounding
  flagged as an open follow-up.
- `docs/HiFi-exegesis-nt-roadmap.md` — mark Phase 6 ✅ done.
- `docs/security-register.md` — review only if the nightly CI job introduces
  `OPENAI_API_KEY` / `AI_GATEWAY_API_KEY` as CI secrets that need documenting.

## Acceptance criteria

1. `npm run eval:gate` runs with only `DATABASE_URL` set (no OpenAI/Gateway key),
   prints a per-metric summary, and exits 0 on the calibrated dataset / non-zero
   on any breach. It uses `semanticEnabled=false` retrieval throughout.
2. The gate enforces Context Precision, Context Recall (mean + per-question
   floor), 100% required lemma/domain coverage, and 100% citation resolvability.
3. The golden dataset has ~20 reviewed items covering all five query types and
   validates against its schema in a unit test.
4. `npm run eval:report` runs the full hybrid pipeline **once per question**,
   derives both the metrics and (when `OPENAI_API_KEY` is set) the judged answer
   from that single `EvidencePacket`, and judges faithfulness via the Vercel AI
   Gateway when `AI_GATEWAY_API_KEY` is set — cleanly omitting faithfulness when
   it is not. The report records API/model/rerank status per question.
5. `report.html` shows the summary scorecard, per-question golden-vs-retrieved
   diff, retrieval trace with rerank status, coverage, and faithfulness verdicts.
6. Unit + integration tests for the harness pass; `npm run verify` stays green.
7. README, PROJECT_STATE, and roadmap updated; the gate is wired as a CI step
   separate from `npm run verify`.
