# Assistant: Dynamic, Grounded, Question-Shaped Answers — Design (Stage 1)

*Status: design approved for spec review · 2026-06-26 (rev. 2 — incorporates external-review edits: retrieved-only synthesis, lexical-metadata guardrails, total enrichment budget, application-trigger rule, output examples)*
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

- No schema or UI-component change — the answer stays a markdown `answer` + `claims[]`.
  **Precise meaning:** "rendering unchanged" means the rendering *component* is untouched. The
  **markdown answer shape does change** (intent-shaped structure; an optional `Going further`
  section). Answers will not look the same — only the renderer is the same.
- No structured-answer schema, no `derivesFrom` links, no migration, no UI restructure —
  those are **Stage 2** (documented below).
- No change to the deterministic **eval gate** (`eval/gate.ts`): it checks citation
  resolvability + required-lemma coverage, not prose shape, so it is unaffected.

## Guiding principle (the "derivation chain")

> Write a **grounded core** from the evidence first. You may then **go further**
> (interpretation/application) only when the question calls for it, and every such
> statement must explicitly build on a stated observation from the core. No claim that
> isn't traceable to the evidence. No lexical/grammatical force beyond the provided
> morphology/glosses/domains. No cross-references or doctrine **that aren't in the retrieved
> evidence**.

Interpretation is not banned — it is *required to show its work*. The failure mode we kill
is not "the model interpreted" but "the model interpreted something that doesn't follow
from what was retrieved."

**Guardrails on the new lexical evidence** (Components 1–2):

- *Retrieved-only synthesis.* "No cross-references or doctrine" means none that aren't in the
  retrieved evidence. Connecting **retrieved** passages is encouraged — it is the point of
  `topic-survey` — but importing **unretrieved** passages or doctrine is not.
- *Don't overclaim from metadata.* A Louw-Nida domain label is a broad orienting category, not
  semantic proof (e.g. "Communication (33)" orients λόγος but does **not** establish a Logos
  theology). A token `gloss` is one context-limited English aid, not the word's full range —
  phrase it as "the gloss given is …", not "the word means …", especially for theology-heavy
  terms (πίστις, δικαιοσύνη, σάρξ, πνεῦμα, νόμος, κόσμος, λόγος).
- *Only mention what's present.* Morphology / gloss / domain are unevenly populated. If a field
  is absent for a token, omit it — never infer or invent it. The model may reference only
  fields actually present in the evidence.
- *SBLGNT drives claims.* Already enforced by `lib/ai/grounding.ts` (WEB mismatch is a caveat,
  never authority) and retained here; enrichment is SBLGNT-only, so no WEB wording can drive a
  claim where the Greek differs.

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

```text
- John 1:1, SBLGNT: Ἐν ἀρχῇ ἦν ὁ λόγος…
    λόγος · λόγος · noun — nominative singular masculine · "word" · Communication (33)
    ἦν · εἰμί · verb — imperfect active indicative, 3rd person singular · "was" · State (13)
```

Constraints:
- **Span gate:** enrich per-token **only when the passage span ≤ 25 verses** (the project's
  existing "long passage" threshold). Above 25 verses → verse-text-only, as today.
- **Content-word filter:** annotate content tokens only; skip a stoplist POS set
  (article, conjunction, particle) by default — **but bypass the stoplist** when (a) the intent
  is `morphology` (function words can be the point — argument-flow conjunctions, the article in
  grammar questions), or (b) the token is the direct target of the query's lemma/morphology
  search. Tunable constant; exact POS set + bypass conditions are a plan detail.
- **Total enrichment budget:** the per-passage span gate bounds a *single* passage; it does
  **not** bound a multi-passage prompt (e.g. several short passages in one `topic-survey` or
  comparison). Enrichment must also respect a **total enrichment budget** that composes with the
  existing `MAX_EVIDENCE_CHARS` cap in `assembleEvidence`: enrich passages in priority order and
  degrade later passages to verse-text-only once the budget is reached (exact threshold/mechanism
  → plan). Worst single passage ≈ 25 verses × ~10 content tokens × ~80 chars ≈ 20 KB, SBLGNT-only.
- **Missing data:** absent morphology / gloss / domain fields are omitted from the annotation
  line, never placeholdered.

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

The existing rules in `SYNTHESIS_SYSTEM_PROMPT` are retained unchanged — the Greek-quoting
discipline, the **English-explanation-first / every-Greek-word-glossed** rule (so the reader
never has to translate), and the `claims[]` contract (claims remain the grounding spine).

**When does the question invite "going further" (application/reflection)?** The model includes
it only on an explicit invitation, not by default. Detection method (model judgment vs. cue
list) is a plan detail; the rule is:

- *Invites it:* "How should Christians apply this?", "What does this mean for believers?",
  "What is the theological significance?", "How might this preach?", open "what does this
  passage teach?" framings.
- *Does not:* "Parse this verb.", "What does this word mean?", "Where else does this lemma
  occur?", "Summarize / show the passage.", a bare verse lookup.

Depth scales by intent and is stated **explicitly in the prompt** (brief lookup · medium
passage/word/topic study · concise+technical morphology · longer only on escalated synthesis),
with `max_output_tokens` as the hard ceiling.

### Component 3 — Grounded-core → "going further" prose contract

Rendering is unchanged (markdown `answer` + `claims[]`). The tiering is a **prose
convention**: the grounded core comes first; if the model goes further, it appears under a
clear marker (a `Going further` heading) and is phrased as derivation ("Because the text says
X …, it follows that …"). That marker is the segmentation signal the manual judge can use and
— critically — the **precursor to Stage 2's structured `goingFurther[]`**.

**Citation behavior is unchanged.** `claims[]` stay verse-level (the `greekQuote` already pins
the specific word within the verse); the new token annotations *inform* the prose but do **not**
introduce token-level claim references in Stage 1 — that is a Stage 2 schema change.

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
  migration); the assistant request carries the flag. The toggle's helper text should note the
  scholarly model may be slower / more thorough.
  - **Limitation (intentional for Stage 1):** a cookie is per-browser/per-device and not synced
    across sessions. For authenticated users the durable home is an account/user setting; that
    is deferred to avoid a Stage-1 migration (see Out of scope).
- When the preference is **on** and the detector fires confidently, route to the scholarly
  model **on the first pass** (no double-run, no clicking). When **off**, behavior is the
  improved recommend-only path (the button now actually appears).
- Keep the manual `escalate` button path intact for the off case.

**Verification.** Note `synthesizeWithRefinement` can make **two** synthesis calls (an initial
call + one refinement round), so "exactly once" is the wrong assertion. The test asserts that
when escalated, **synthesis uses the scholarly model and the default model is never called** —
the assertion is on *which* model, not a single call. Transient-retry, model-failure, and
deterministic-fallback semantics are unchanged from today and their exact test definitions are
pinned in the plan. Confirm `gpt-5.4` (or `OPENAI_SCHOLARLY_MODEL`) is reachable in the target
account.

## Output examples (target shapes, illustrative not literal)

These pin the intent of the shapes; final wording is the model's. Priority shapes first.

**Morphology — "Parse ἦν in John 1:1."** (concise, technical, no "going further")
> **ἦν** (John 1:1) — verb, imperfect active indicative, 3rd person singular of **εἰμί**
> ("to be"); the provided gloss is "was."

**Passage-study — "What does John 1:14 mean?"** (grounded core; no application unless asked)
> John 1:14 says the Word **became flesh** — **σάρξ** ("flesh") — and **ἐσκήνωσεν** ("dwelt,"
> lit. "tabernacled") among us, and that we beheld his **δόξα** ("glory"), full of **χάρις**
> ("grace") and **ἀλήθεια** ("truth"). The verbs **ἐγένετο** ("became") and **ἐσκήνωσεν**
> ("dwelt") are both aorist, per the provided morphology.
>
> **Going further** *(included only because "what does it mean" invites it)*: Because the text
> says the Word "became (ἐγένετο) flesh" and "dwelt (ἐσκήνωσεν) among us," the verse presents the
> incarnation as **the Word** taking up real residence among humans — an inference resting on those
> two glossed aorist verbs above, not on the Word=God identification (which would need John 1:1) or
> any outside doctrine.

**Topic-survey — "Verses about reconciliation."** (synthesize the *retrieved* set only)
> Across the retrieved passages, reconciliation centers on **καταλλαγή / καταλλάσσω**: Rom 5:10–11
> (reconciled to God through the death of his Son), 2 Cor 5:18–20 (the ministry of
> reconciliation), Col 1:20–22, Eph 2:16.
>
> **Going further**: The thread connecting *these retrieved passages* is that God is the
> reconciler and Christ's death is the means — a synthesis of the verses above, with no passage
> imported beyond what was retrieved.

## Measurement plan (2A now, 2B next)

- **2A (this stage):** keep `eval/judge.ts` **unchanged**. Capture a baseline report on
  current `main` (`npm run eval:report`), then re-run after the Component 1–4 answer changes,
  and diff: mean faithfulness, and the **composition** of ✗ statements (B/C overreach should
  drop sharply; remaining ✗'s should be defensible interpretation). Because keeping
  interpretation means a *better* answer can still score lower on the old single number, we
  read both the absolute score **and** the ✗ composition. Consider adding a few
  `passage-study` / `topic-survey` golden items to sharpen the signal on the priority shapes.
  Expect `Going further` statements to **stay noisy** under the unchanged judge (it can't see
  the derivation link). Manually triage each `Going further` ✗ as either a **defensible
  derivation** (follows from a grounded observation — judge blind spot) or a **genuine leap**
  (the failure we're killing). That triage is the raw material that designs the 2B rubric.
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
  and escalation routes synthesis to the scholarly model, not the default (Component 5).
- Integration (Neon test branch): the new `getPassageTokens` query path; enriched word-search
  glosses.
- Acceptance: `scripts/acceptance-test.js` assertions are pinned to corpus counts and answer
  shape — review for any answer-shape assertions that the new format changes, and update in
  lockstep (not caught by `npm run verify`).
- **Test-impact sweep (broader than acceptance):** review every test that asserts answer
  wording / headings / markdown structure, `claims` counts, prompt directives, or routing
  behavior — at minimum `tests/unit/lib/ai/synthesis.test.ts`, `tests/unit/lib/ai/modelRouter.test.ts`,
  `tests/unit/components/AiAssistant-scholarly.test.tsx`, `tests/unit/lib/ai/assistant.test.ts`,
  `tests/unit/api/assistant-route.test.ts`. Update in lockstep with the new shapes.

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
- **Token-level claim evidence references** — would change the `claims[]` schema (Stage 2).
- **Moving the auto-escalate preference into a DB account/user setting** — needs a migration
  excluded from Stage 1; cookie-backed preference is used instead, with the account-setting
  noted as the future home.
- Runtime self-critique / refinement loop (the original "Approach 3" — held in reserve).
- Prose-sweep grounding of inline references (separate existing follow-up in
  `docs/PROJECT_STATE.md`).

## Deferred to the implementation plan (mechanics, not design)

These are intentionally left at design altitude here and pinned when the plan is written: the
exact synthesis prompt strings for every shape/guardrail; the content-word POS stoplist and its
bypass conditions; the total-enrichment-budget threshold and degradation order; token-annotation
ordering (verse then `wordIndex`); the application-trigger detection method (model judgment vs.
cue list); and the escalation retry / model-failure / fallback test definitions.

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
