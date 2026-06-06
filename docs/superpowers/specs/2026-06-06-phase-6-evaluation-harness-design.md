# Phase 6 — Evaluation Harness Design

*Milestone 3, Phase 6 (final phase). Date: 2026-06-06.*

## Purpose

Phases 1–5 built the retrieval-first, grounded NT-exegesis assistant pipeline
(deterministic retrieval → semantic/hybrid + RRF → Voyage rerank → Louw-Nida →
synthesis → grounding verification). Phase 6 is the **quality gate** over that
whole pipeline: an automated, repeatable way to measure whether retrieval
surfaces the right evidence and whether answers stay faithful to it, so
regressions are caught when the pipeline is later touched.

The top priority for this Bible-study app is preventing **citation-shaped
hallucinations** (invented or misattributed scripture). The harness therefore
splits into:

- A **blocking PR gate** that is fast, free, and 100% deterministic — strictly
  enforcing Context Precision and Context Recall over the hybrid retrieval, and
  running `verifyGrounding` to catch citation-shaped hallucinations via
  deterministic string matching.
- A **non-blocking nightly / on-demand dashboard** that additionally runs live
  synthesis and an LLM-as-judge faithfulness evaluation, producing a rich
  per-question HTML report for debugging *why* a specific verse or Greek lemma
  was (or was not) retrieved. Nondeterminism and API cost are acceptable here
  because it never blocks CI.

This matches the deterministic-gate / fuzzy-dashboard split decided during
brainstorming.

## Scope

**In scope:**
- A standalone `eval/` layer that drives the existing pipeline against a curated
  golden dataset and scores the results.
- A ~20-item hand-curated golden dataset spanning all five query types the
  pipeline handles.
- Deterministic metrics: Context Precision, Context Recall, grounding pass-rate.
- A deterministic blocking gate (`npm run eval:gate`) with tunable thresholds.
- A nightly/on-demand run (`npm run eval:report`) adding LLM-judge faithfulness
  and a self-contained HTML report (+ JSON dump).
- Unit and integration tests for the harness itself.
- Docs updates (README, PROJECT_STATE, roadmap).

**Out of scope:**
- **Prose-sweep grounding hardening** (PROJECT_STATE.md line ~172 — verifying
  inline prose references, not just declared `claims[]`). That is a change to
  the grounding *verifier*, not the eval harness; it stays a separate follow-up.
- Any change to the runtime retrieval/synthesis/grounding pipeline. Phase 6 only
  *measures* the existing pipeline — no schema changes, no behavior changes.
- Auto-derived / generated questions (may be added later; the dataset schema is
  designed to allow it, but v1 is hand-curated only).
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
  eval runner ── runs each question through the real pipeline:
        │          extractSignals → buildPlan → runRetrievalPlan   (retrieval)
        │          verifyGrounding                                  (grounding)
        │          [nightly only] live synthesis → LLM-judge        (faithfulness)
        ├──────────────┬───────────────────────────────┐
        ▼              ▼                                 ▼
  metrics scorer   PR gate (deterministic)          HTML report writer
  (precision/        exit 1 if below threshold        (nightly + on-demand)
   recall/grounding)
```

The PR gate and the nightly dashboard run the **same runner**. They differ only
in (a) whether the live-synthesis + LLM-judge stage executes, and (b) whether
output is a pass/fail exit code or an HTML/JSON artifact.

## File layout

```
eval/
  dataset/
    golden-set.json            # ~20 curated questions + golden refs (committed)
    schema.ts                  # types + a zod validator for the dataset
  thresholds.ts                # gate threshold constants (single source of truth)
  runner.ts                    # drives a question through the pipeline → RunResult
  metrics.ts                   # contextPrecision, contextRecall, grounding pass-rate
  judge.ts                     # LLM-as-judge faithfulness (nightly only, key-gated)
  report.ts                    # RunResult[] → static HTML + JSON
  output/                      # gitignored: report.html, report.json
scripts/
  eval-gate.ts                 # npm run eval:gate   — deterministic, exit code
  eval-report.ts               # npm run eval:report — full run + HTML (nightly/on-demand)
tests/unit/eval/               # unit tests for metrics, dataset validity, thresholds
tests/integration/eval-runner.test.ts  # one-question end-to-end smoke
```

`eval/` is new and self-contained, mirroring how `lib/search/` and `lib/ai/` are
organized.

## The golden dataset

Each item exercises one pipeline path:

```jsonc
{
  "id": "agape-1cor13",
  "question": "What does ἀγάπη mean in 1 Corinthians 13?",
  "queryType": "lemma-survey",        // exact-verse | lemma-survey | conceptual | domain | cross-chapter
  "goldenReferences": ["1Cor 13:1", "1Cor 13:2", "..."],  // refs that SHOULD be retrieved
  "mustContainLemma": "ἀγάπη",        // optional: retrieval must surface this lemma
  "notes": "Tests lemma survey + semantic expansion within a single chapter"
}
```

- **`goldenReferences`** drive Context Precision/Recall — the heart of the
  deterministic gate. Stored in the codebase's canonical reference form
  (`<osisId> <chapter>:<verse>`, e.g. `1Cor 13:1`, matching
  `formatReference`/`parseReference` in `lib/references.ts`) and re-normalized via
  `parseReference` before comparison.
- **`queryType`** groups report results and lets a test assert coverage across
  all five pipeline paths.
- No "golden answer" prose is stored. Faithfulness is judged against *retrieved
  evidence* (the RAGAS definition), not against a fixed expected answer — this
  avoids brittle string-matching on generated prose.
- The ~20 items are split across the five query types so every retrieval path
  (deterministic, semantic/RRF, rerank, domain) is represented. The exact
  questions are drafted during implementation and submitted for maintainer
  review before the gate thresholds are calibrated.

`schema.ts` exports a zod schema; a unit test validates `golden-set.json` against
it and asserts every `queryType` appears at least once.

## Metrics

References are normalized to a canonical `BOOK C.V` form (via `lib/references.ts`)
before any set comparison. Comparisons are made against the `EvidencePacket`
citations that `runRetrievalPlan` actually produces — i.e. the real fused output
of FTS + pgvector + RRF + rerank, exactly what the synthesizer sees.

**Context Precision** — of the references retrieved, what fraction are golden?
`precision = |retrieved ∩ golden| / |retrieved|`. Penalizes noisy retrieval.
Defined as `1.0` when `retrieved` is empty *and* `golden` is empty; `0.0` when
`retrieved` is empty but `golden` is non-empty (nothing relevant surfaced).

**Context Recall** — of the golden references, what fraction were retrieved?
`recall = |retrieved ∩ golden| / |golden|`. Penalizes missing the verse you
needed — the most important metric for a Bible app. Defined as `1.0` when
`golden` is empty.

**Grounding pass-rate** — run `verifyGrounding` over each question's evidence
(on the deterministic-fallback answer, which is grounded-by-construction). A
question passes only if no claim falls below the 0.90 SBLGNT threshold and every
cited reference resolves. This asserts the verifier stays healthy and evidence is
internally consistent — the deterministic anti-hallucination check.

**Faithfulness (nightly only)** — LLM-as-judge decomposes the *live* synthesized
answer into atomic claims and judges each as supported / unsupported by the
retrieved evidence. Score = supported / total. Gated on `OPENAI_API_KEY`; absent
key → skipped (recorded as `null`), never failed.

## Gate thresholds

`npm run eval:gate` runs deterministically and exits non-zero if **any** of these
fail, aggregated across the dataset. Constants live in `eval/thresholds.ts` (one
source of truth) and are asserted by a unit test so an accidental threshold edit
is itself caught.

| Metric | Starting threshold | Rationale |
|---|---|---|
| Mean Context Recall | ≥ 0.90 | Don't silently start missing the right verses |
| Mean Context Precision | ≥ 0.80 | Some semantic ±2-window noise is acceptable; recall matters more |
| Grounding pass-rate | 100% | Zero tolerance for unresolved/mismatched citations |
| Per-question recall floor | ≥ 0.50 | Catch a single catastrophically-broken query a healthy mean would hide |

These are **starting** values. The gate is calibrated against the *actual* first
run so it starts green, then ratcheted up. Calibration happens after the dataset
is reviewed and the first run is observed.

## Execution model

- **PR / CI (blocking):** `npm run eval:gate` — needs only `DATABASE_URL` (the
  Neon test branch via `.env.test`). Deterministic, fast, free. Wired as a
  dedicated CI step (and runnable alongside `npm run verify`). Prints a per-metric
  summary and exits non-zero on any breach.
- **Nightly / on-demand (non-blocking):** `npm run eval:report` — runs everything
  the gate does plus live synthesis + LLM-judge faithfulness, writes
  `eval/output/report.html` and `eval/output/report.json`. Run via a scheduled
  job or by hand; uploaded as a CI artifact on the nightly. Degrades gracefully
  to deterministic-only output when `OPENAI_API_KEY` is unset.

## The HTML report

Single self-contained file (inline CSS, editorial-scholar palette). Structure:

- **Summary scorecard** — the four gate metrics + faithfulness, with pass/fail
  badges and the active thresholds.
- **One card per question:**
  - Query text + `queryType` badge, overall pass/fail.
  - **Golden vs Retrieved references** side by side — golden refs marked ✓ hit /
    ✗ missed; retrieved refs marked in-golden / extra-noise. The "why didn't my
    verse get retrieved" view.
  - **Retrieval trace** — the RRF-fused ordering with each hit's source
    (FTS / vector) and post-rerank position, so a relevant verse that was a
    candidate but got buried below the cutoff is visible.
  - Faithfulness verdict (nightly) — each claim with supported/unsupported and
    the judge's reason.

`eval/output/report.json` is written alongside so the underlying data is
available to tooling without parsing HTML. `eval/output/` is gitignored.

## Testing

- **Unit** (`tests/unit/eval/`):
  - `metrics.ts` — precision/recall math, reference normalization, empty-set edge
    cases (both-empty, retrieved-empty, golden-empty).
  - dataset validity — `golden-set.json` parses against the zod schema; every
    `queryType` is represented; all golden references parse via `lib/references.ts`.
  - `thresholds.ts` — sanity bounds (all in `[0,1]`, recall floor ≤ mean recall
    threshold).
- **Integration** (`tests/integration/eval-runner.test.ts`): the runner executes
  one question end-to-end against the Neon test branch and produces a well-formed
  `RunResult`. Skips itself when `DATABASE_URL` is unset (matching existing
  integration-suite convention).
- `eval/**` is included in lint + tsc. The harness is not itself part of the
  runtime coverage gate (`app/api/**` + `lib/**`).

## Documentation & housekeeping

Per CLAUDE.md:
- `README.md` — document the new `eval:gate` / `eval:report` scripts and the
  golden-set location.
- `docs/PROJECT_STATE.md` — mark Phase 6 done; describe the harness, the gate,
  and the dashboard; note the calibrated thresholds.
- `docs/HiFi-exegesis-nt-roadmap.md` — mark Phase 6 ✅ done.
- `docs/security-register.md` — no new advisory expected; review only if the
  nightly job introduces a CI secret (`OPENAI_API_KEY`) that needs documenting.

## Acceptance criteria

1. `npm run eval:gate` runs with only `DATABASE_URL` set, prints a per-metric
   summary, and exits 0 on the calibrated dataset / non-zero on any breach.
2. The golden dataset has ~20 reviewed items covering all five query types and
   validates against its schema in a unit test.
3. Context Precision, Context Recall, and grounding pass-rate are computed from
   the real `EvidencePacket` output of the existing pipeline.
4. `npm run eval:report` produces a self-contained `report.html` with the
   summary scorecard and per-question golden-vs-retrieved + retrieval-trace
   cards; LLM-judge faithfulness appears when `OPENAI_API_KEY` is set and is
   cleanly omitted when it is not.
5. Unit + integration tests for the harness pass; `npm run verify` stays green.
6. README, PROJECT_STATE, and roadmap updated.
