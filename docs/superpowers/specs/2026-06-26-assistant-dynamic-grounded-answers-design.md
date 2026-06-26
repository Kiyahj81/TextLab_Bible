# Assistant: Dynamic, Grounded, Question-Shaped Answers — Design (Stage 1)

*Status: design approved for spec review · 2026-06-26*
*Scope: Stage 1 of a two-stage arc. Stage 2 (structured tiered answer) is documented as a deferred pathway at the end of this doc.*

## Problem

The AI Study Assistant produces every answer in the same hardcoded three-section
template — defined in `SYNTHESIS_SYSTEM_PROMPT` (`lib/ai/synthesis.ts`) and echoed in
`buildDeterministicFallback`:

1. Textual observations
2. Interpretive suggestion
3. Application/reflection

Two problems, which turn out to share one root cause:

1. **Fit & proportion.** The template is forced onto every question regardless of type
   or complexity. A parsing question gets a hollow "Application/reflection"; a simple
   verse lookup is bloated into three headings it never needed. Depth doesn't scale to
   the question. (User priorities: this is the "A + C" concern.)

2. **Low faithfulness.** The weekly eval report (`eval/report.ts`, judged by
   `eval/judge.ts`) shows persistently low faithfulness. The judge decomposes the **prose
   `answer`** into atomic statements and scores each as supported/unsupported *against the
   retrieved evidence block*. Grounding (`lib/ai/grounding.ts`) only verifies the separate
   `claims[]` array — so the prose can drift from the evidence and still pass grounding.
   Observed unsupported statements fall into three buckets, all genuine ungrounding (not a
   judge artifact):
   - **A — interpretation/application overreach** ("this teaches us…", "we should…")
   - **B — lexical/grammatical over-claiming** ("the perfect tense emphasizes enduring
     result") — meaning the retrieved evidence doesn't actually contain
   - **C — outside theological framing** — cross-references / doctrine never retrieved

### Root cause

The three-section template is the shared cause. Two of its three mandatory sections
(*Interpretive suggestion*, *Application/reflection*) are **by definition** not grounded
in the retrieved verses — they require the model to go beyond the text — so the template
manufactures exactly the unsupported statements the judge penalizes, on **every** answer.
Meanwhile the most common path, `passageCall` in `lib/ai/retrievalPlanner.ts`, emits only
bare verse text (no morphology, gloss, or semantic domain), so any lexical observation is
*guaranteed* to be unsupported by the evidence even when it is correct.

Therefore fit/proportion and faithfulness pull the **same** direction: shape the answer to
the question (grounded core by default; interpretation only when invited and only as a
visible derivation from the core), and give the model — and the judge — the lexical
evidence the corpus already holds.

## Goals

- Answers take a shape appropriate to the question type and right-size their depth.
- The prose is grounded in retrieved evidence; interpretation is permitted but must
  **visibly derive** from a grounded textual observation (no leaps disconnected from the
  evidence).
- Lexical/grammatical observations become *legitimately grounded* by surfacing the
  morphology, glosses, and Louw-Nida domains the corpus already stores.
- The scholarly model is actually leveraged when a question warrants it.

### Non-goals (Stage 1)

- No change to the answer **rendering** (stays markdown `answer` + `claims[]`).
- No structured-answer schema, no `derivesFrom` links, no migration, no UI restructure —
  those are **Stage 2** (documented below).
- No change to the deterministic **eval gate** (`eval/gate.ts`): it checks citation
  resolvability + required-lemma coverage, not prose shape, so it is unaffected.

## Guiding principle (the "derivation chain")

> Write a **grounded core** from the evidence first. You may then **go further**
> (interpretation/application) only when the question calls for it, and every such
> statement must explicitly build on a stated observation from the core. No claim that
> isn't traceable to the evidence. No lexical/grammatical force beyond the provided
> morphology/glosses/domains. No outside cross-references or doctrine.

Interpretation is not banned — it is *required to show its work*. The failure mode we kill
is not "the model interpreted" but "the model interpreted something that doesn't follow
from what was retrieved."

## Success criteria / how we'll know

Ship the answer changes, then run a **manual 2A snapshot** (see Measurement) for a clean
before/after on the *current, unchanged* judge. Success looks like:

- In the weekly/manual report, the ✗ (unsupported) statements shift away from B/C overreach
  (lexical invention, outside theology) toward — at most — clearly-labeled interpretation.
- Grounded-core faithfulness rises (B-type observations now score *supported* because the
  evidence contains the morphology/gloss/domain backing them).
- The scholarly model is recommended on genuinely complex prompts and (with the opt-in on)
  is actually used.

## Design — five components

### Component 1 — Evidence enrichment (foundation)

The lever that removes most B-type failures. The corpus already stores this data;
`getReaderPassage` (`lib/search/reader.ts`) already resolves it for the reader. It is simply
never surfaced to the synthesizer. Because the judge reads the **same**
`evidence.formattedEvidence`, enrichment improves grounding *and* lets the judge credit a
fair observation — with **no judge code change**.

**1a. Passage evidence (the big gap).** `passageCall` currently emits
`- John 1:14, SBLGNT: <text>` and nothing else. Add a focused SBLGNT token fetch over the
passage's verse range — a trimmed `getReaderPassage` token path: **no** user notes/highlights,
scoped to the verse range, batch-resolving Louw-Nida labels via `resolveTokenDomains`
(`lib/louwNida.ts`) and decoding the morph code via `decodeMorphCode` (`lib/morphology.ts`).
Proposed new function: `getPassageTokens({ book, chapter, verseStart, verseEnd })` in the
search layer (SBLGNT only).

Under each verse, emit a per-token annotation line, e.g.:

```
- John 1:1, SBLGNT: Ἐν ἀρχῇ ἦν ὁ λόγος…
    λόγος · λόγος · noun nominative singular masculine · "word" · Communication (33)
    ἦν · εἰμί · verb imperfect active indicative, 3rd person singular · "was" · State (13)
```

Constraints:
- **Span gate:** enrich per-token **only when the passage span ≤ 25 verses** (the project's
  existing "long passage" threshold). Above 25 verses → verse-text-only, as today.
- **Content-word filter:** annotate content tokens only; skip a stoplist POS set
  (article, conjunction, particle) to control volume. Tunable constant.
- **Budget:** worst case ≈ 25 verses × ~10 content tokens × ~80 chars ≈ 20 KB, SBLGNT-only,
  well within `MAX_EVIDENCE_CHARS` (58 KB).

**1b. Word/lemma/morphology/domain searches.** Those sections already carry the **raw**
`morphCode`. Decode it via `decodeMorphCode` and append the token `gloss`. Requires adding
`gloss` (and optionally the LN domain label) to the relevant search result shapes
(`searchLemma` / `searchMorphology` / `searchDomain` in `lib/search/*`). These sections are
already capped at `MAX_WORD_SAMPLE` (25 rows), so the cost is bounded.

### Component 2 — Intent-shaped synthesis + derivation chain

`extractSignals` already classifies every prompt into an `Intent`
(`word-study | passage-study | topic-survey | morphology | comparison | general`), computed
in `answerBibleQuestion` (`lib/ai/assistant.ts:45`) but ignored by synthesis. Thread it into
`synthesizeWithRefinement` (extend `SynthesisInput` with `intent`) and select a shape:

| Intent | Shape | Default depth | Application/reflection? |
|---|---|---|---|
| `morphology` | Parse / forms, technical | Short | No |
| `passage-study` | What it says + key lexical observations → meaning | Medium | Only if the question invites it |
| `word-study` | Occurrences + senses across hits | Medium | Rarely |
| `topic-survey` | Passages + the thread connecting them | Medium | If invited |
| `comparison` | Side-by-side, supported contrast only | Medium | If invited |
| `general` | Grounded answer scaled to the question | Scales | If invited |

The derivation-chain principle (above) is the constant law across all shapes, expressed as
prompt rules. Length scales by intent through prompt guidance; `max_output_tokens` remains
the hard ceiling (no per-intent hard caps in Stage 1).

**Priority shapes to get right first: `passage-study` and `topic-survey`** (most common and
worst-grounded today).

The existing Greek-quoting rules and the `claims[]` contract in `SYNTHESIS_SYSTEM_PROMPT` are
retained unchanged — claims remain the grounding spine.

### Component 3 — Grounded-core → "going further" prose contract

Rendering is unchanged (markdown `answer` + `claims[]`). The tiering is a **prose
convention**: the grounded core comes first; if the model goes further, it appears under a
clear marker (a `Going further` heading) and is phrased as derivation ("Because the text says
X …, it follows that …"). That marker is the segmentation signal the manual judge can use and
— critically — the **precursor to Stage 2's structured `goingFurther[]`**.

### Component 4 — Deterministic fallback

`buildDeterministicFallback` (`lib/ai/synthesis.ts`) currently hardcodes the same three
sections. Rewrite to the core-only shape (it embeds retrieved evidence verbatim and never
interprets — grounded by construction) so live and fallback modes stay coherent and the
fallback no longer ships forced interpretation/application.

### Component 5 — Model routing & scholarly escalation (R-B)

**Diagnosis.** Escalation works end-to-end (`routeAssistantPrompt(prompt, escalate)` →
scholarly model; `/api/assistant` accepts `escalate`; `AiAssistant.tsx:313` renders the "Use
scholarly model" button when `recommendedUpgrade` is set). But `recommendScholarlyUpgrade`
only fires on literal jargon strings ("theological nuance", "cross-text", "deep synthesis",
…) that real questions never contain — so the recommendation, and thus the button, **never
appears**. The detector is effectively dead.

**Fix — detection.** Replace the string-match list with the signals already extracted.
Recommend scholarly when the prompt shows real complexity, e.g.:
- `intent === "comparison"`, or references spanning **≥ 2 distinct books** (cross-text synthesis)
- tension/synthesis framing ("reconcile", "tension", "paradox", "how can … and …", "why does")
- several distinct topic words in one question
- long / multi-clause prompts
- (retain a broadened explicit-cue list for direct "use the scholarly model" asks)

**Fix — action (R-B, opt-in auto-escalate).**
- Add a user preference **"Automatically use the scholarly model when a question warrants
  it,"** default **off** (preserves the cost guardrail and the never-automatic-*by-default*
  principle). Stored cookie-backed, consistent with the existing reader-prefs pattern (no
  migration); the assistant request carries the flag.
- When the preference is **on** and the detector fires confidently, route to the scholarly
  model **on the first pass** (no double-run, no clicking). When **off**, behavior is the
  improved recommend-only path (the button now actually appears).
- Keep the manual `escalate` button path intact for the off case.

**Verification.** Add a test asserting that escalation / auto-route calls the scholarly model
**exactly once**; confirm `gpt-5.4` (or `OPENAI_SCHOLARLY_MODEL`) is reachable in the target
account.

## Measurement plan (2A now, 2B next)

- **2A (this stage):** keep `eval/judge.ts` **unchanged**. Capture a baseline report on
  current `main` (`npm run eval:report`), then re-run after the Component 1–4 answer changes,
  and diff: mean faithfulness, and the **composition** of ✗ statements (B/C overreach should
  drop sharply; remaining ✗'s should be defensible interpretation). Because keeping
  interpretation means a *better* answer can still score lower on the old single number, we
  read both the absolute score **and** the ✗ composition. Consider adding a few
  `passage-study` / `topic-survey` golden items to sharpen the signal on the priority shapes.
- **2B (designed from 2A results):** split the judge into two honest metrics —
  *exegetical faithfulness* (textual claims supported by evidence; must stay high) and
  *inference-grounded rate* (fraction of interpretive statements that demonstrably follow
  from the evidence/core). This is **more** rigorous, not more lenient, and directly measures
  the derivation-chain principle. The exact rubric is intentionally deferred until the 2A
  snapshot shows what the real failure distribution looks like. (Aligns with the project's
  eval-calibration philosophy: fix the measurement to be meaningful; never lower a threshold
  to pass.)

## Testing

- Unit: enriched-evidence formatting incl. span gate + content-word filter (Component 1);
  intent→shape selection and derivation-chain prompt directives, mirroring existing
  `tests/unit/lib/ai/synthesis.test.ts` prompt assertions (Component 2); core-only fallback
  shape (Component 4); routing detection fires on complex prompts and not on simple ones,
  and escalation calls the scholarly model exactly once (Component 5).
- Integration (Neon test branch): the new `getPassageTokens` query path; enriched word-search
  glosses.
- Acceptance: `scripts/acceptance-test.js` assertions are pinned to corpus counts and answer
  shape — review for any answer-shape assertions that the new format changes, and update in
  lockstep (not caught by `npm run verify`).

## Risks & mitigations

- **Evidence bloat** → span gate (≤ 25 verses) + content-word filter + SBLGNT-only
  enrichment; bounded well under `MAX_EVIDENCE_CHARS`.
- **Prompt-tuning iteration** → measured directly by the 2A report; no blocking-CI risk since
  the gate is structure-agnostic.
- **Auto-escalation cost** → default off; opt-in; first-pass routing avoids double model
  calls.
- **Acceptance drift** → explicit review/update step above.

## Out of scope (Stage 1)

- Structured tiered answer schema, rendering, persistence (Stage 2).
- Runtime self-critique / refinement loop (the original "Approach 3" — held in reserve).
- Prose-sweep grounding of inline references (separate existing follow-up in
  `docs/PROJECT_STATE.md`).

---

## Stage 2 (deferred) — Structured tiered answer: the pathway

This is the durable "right" architecture and **must not be lost**. Stage 1 is deliberately
designed to lay its seams. Track this in `docs/HiFi-exegesis-nt-roadmap.md` and the
`docs/PROJECT_STATE.md` outstanding-items list when Stage 1 lands.

**What Stage 2 is.** Replace the free prose `answer` with a structured, machine-checkable
answer object:
- `core[]` — grounded segments, each tied to its `reference` and the exact evidence it rests
  on. This **unifies the prose with the verified claims**, closing the prose/claims divorce
  that is the source of the faithfulness gap.
- `goingFurther[]` — interpretive segments, each carrying an explicit `derivesFrom` link to
  the `core` observation(s) it builds on.
- Grounding verifies `core` (as today) **and** checks that every `goingFurther` item links to
  a real `core` id (the derivation chain becomes enforceable, not just encouraged).
- The judge adopts the **2B split metric**: faithfulness over `core`; inference-grounded rate
  over `goingFurther`.
- `AiAssistant` renders the tiering visibly (grounded core, then a marked "Going further" with
  its derivation), and persistence (`AssistantMessageMetadata` / generated-study-note) stores
  the structured answer.

**Seams Stage 1 builds for it (the migration path):**
- The **"Going further" heading convention** (Component 3) becomes the structured
  `goingFurther[]` boundary.
- The **derivation-chain prompt rule** (Component 2) becomes the `derivesFrom` schema link.
- The **enriched evidence** (Component 1) carries straight over unchanged — it is what makes
  grounded `core` lexical segments possible.
- The **2A→2B measurement work** designs exactly the judge Stage 2 needs.

**Trigger to start Stage 2.** When the 2A snapshot and subsequent reports show that prompt-
level discipline (Stage 1) has plateaued — i.e. interpretation grounding can't be pushed
higher without machine-enforced structure — promote Stage 2 from deferred to active and write
its own spec → plan → implementation cycle.

## File-level change map (orientation, not a task list)

- `lib/search/reader.ts` (or a new `lib/search/passageTokens.ts`) — `getPassageTokens` query.
- `lib/search/{lemma,domain,…}.ts` — add `gloss` (+ optional LN label) to result shapes.
- `lib/ai/retrievalPlanner.ts` — enrich `passageCall` (span gate + content-word annotation);
  decode morph + append gloss in word/lemma/morph/domain sections.
- `lib/morphology.ts`, `lib/louwNida.ts` — reused (`decodeMorphCode`, `resolveTokenDomains`).
- `lib/ai/synthesis.ts` — intent-shaped prompt + derivation-chain rules; `SynthesisInput.intent`;
  core-only `buildDeterministicFallback`.
- `lib/ai/assistant.ts` — pass `signals.intent` into synthesis; thread the auto-escalate flag.
- `lib/ai/modelRouter.ts` — signal-based `recommendScholarlyUpgrade`; first-pass auto-route.
- `app/api/assistant/route.ts` — accept the auto-escalate preference flag.
- `components/AiAssistant.tsx` — auto-scholarly toggle (cookie-backed).
- `eval/*` — 2A baseline run (no code change); 2B split metric (later, designed from 2A).
- `scripts/acceptance-test.js` — update any answer-shape assertions in lockstep.
