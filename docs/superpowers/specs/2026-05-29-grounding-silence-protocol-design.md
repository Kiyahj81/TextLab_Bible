# Milestone 3 Phase 2 — Grounding + Silence Protocol (Design)

*Status:* Approved for implementation · *Date:* 2026-05-29 · *Branch (planned):* fresh off `main`
*Roadmap:* `docs/HiFi-exegesis-nt-roadmap.md` (Phase 2) · *Predecessor:* Phase 1 orchestration (Paradigm C), shipped on `main`

## Goal

After the live model synthesizes an answer, **verify every textual claim against the real corpus before
the answer is shown or saved.** A fabricated verse reference or a misquoted Greek phrase causes the whole
answer to be withheld and replaced with a structured "insufficient textual evidence" response (the
"Silence Protocol"). This is the single biggest fidelity win in Milestone 3 and uses only the NT data
already loaded (SBLGNT + WEB).

## Core principle: SBLGNT is the citation spine

This phase bakes in a project-wide principle (kept in mind for all later retrieval/grounding work):

- **SBLGNT (Greek critical/eclectic text) is the evidence and citation authority.**
- **WEB (English) — and any future English translations — are display aids only**, not citation authority.
- Crossrefs / notes / morphology are retrieval aids, not citation authority.

Rationale: SBL (NA/UBS-based, eclectic) and the Byzantine/RP tradition WEB loosely follows differ at the
variation-unit level on a massive scale (the SBL introduction reports 5,959 disagreements out of 6,928
variation units — additions, omissions, substitutions). Verse divisions follow NA/UBS, so even
numbering/inclusion can diverge, and WEB is not a pure RP proxy. Therefore a WEB verse at a given
reference must **not** be assumed to represent the SBL Greek there.

Consequences for this phase:

- The **Greek quote, verified against SBLGNT, drives the Silence Protocol** (its failure refuses the answer).
- **WEB quotes are checked against WEB and treated as non-authoritative display aids** — a WEB mismatch
  or a WEB verse absent at the SBL reference strips the aid and attaches an alignment caveat; it never
  refuses the answer.
- **Layered answer policy:** when an answer depends on original-language evidence, the assistant gives
  three levels — readable English meaning first, the Greek phrase as evidence, then a literal gloss —
  with the citation always tied to the Greek source. Greek supports the explanation; it does not replace
  it (keeps answers accessible to non-Greek readers).
- **Citation labeling:** evidence renders as `John 1:14, SBLGNT`; a WEB readable aid renders separately,
  e.g. `"The Word became flesh…" WEB`. The three layers stay distinct: evidence text (SBLGNT) / display
  translation (WEB) / assistant explanation (model-generated).

Full alignment analysis (variation-unit reconciliation, verse-numbering mapping, multiple translations)
is **out of scope for Phase 2** but the data shapes below are designed not to preclude it.

## Architecture decision

**Approach A — the verifier runs inside `answerBibleQuestion` (`lib/ai/assistant.ts`), between
synthesis and persistence.** A new standalone `lib/ai/grounding.ts` module does the verification; the
synthesis step is changed to emit structured output so the verifier has an explicit list of claims to
check.

Why A over the alternatives:

- **vs. B (verify at the API route boundary, as the roadmap sketched):** persistence
  (`finishAssistantExchange`) runs *inside* the answer flow, so verifying at the route would mean saving
  the bad draft and then overwriting it. Verifying before persistence means the database only ever stores
  the final, already-decided answer (the withheld refusal, never the fabricated draft). It also avoids
  threading `claims` onto `AssistantAnswer` purely for the route.
- **vs. C (inline inside `synthesis.ts`):** would couple synthesis with DB resolution and refusal policy,
  make the file do two jobs, and prevent unit-testing the verifier without OpenAI scaffolding.

The verifier sits next to the only component that can hallucinate — live synthesis. The deterministic
fallback paths only echo real retrieved corpus text, so they are grounded by construction and skip
verification.

## Data shapes

A claim is a *layered* unit anchored to a Greek (SBL) reference — not a flat `{reference, corpus, quote}`.
These types live in `lib/ai/grounding.ts` and are imported where needed.

```ts
export type GroundingClaim = {
  // Citation is ALWAYS anchored to the original-language (SBL) unit.
  reference: string;            // "John 1:14" — the SBL reference
  greekQuote: string | null;    // SBLGNT evidence — the citation spine. Verified vs SBLGNT.
  gloss: string | null;         // literal English gloss of the Greek; model-generated,
                                // NOT corpus-verified (it is explanation, not a quote).
  englishQuote: string | null;  // optional WEB readable aid. Verified vs WEB, labeled "WEB".
};

export type ClaimVerdict = {
  claim: GroundingClaim;
  status: "verified" | "reference-not-found" | "quote-mismatch";
  matchScore?: number;          // present for Greek quote claims (0–1)
  resolvedText?: string;        // the real SBL verse text matched against
  alignmentCaveat?: string;     // set when a WEB aid was stripped (non-fatal)
};

export type GroundingReport = {
  grounded: boolean;            // true iff EVERY verdict.status === "verified"
  verdicts: ClaimVerdict[];
};
```

Future English translations generalize `englishQuote` into a list later; Phase 2 wires WEB only.

### Verification rules (asymmetric, by authority)

| Part of claim | Matched against | On failure |
|---|---|---|
| `reference` unparseable / no SBL verse | SBLGNT existence | **Refuse** (spine missing) → `reference-not-found` |
| `greekQuote` (evidence) | SBLGNT verse text, Greek-normalized, ≥0.90 | **Refuse** (Silence Protocol) → `quote-mismatch` |
| `gloss` | nothing — model explanation | never blocks |
| `englishQuote` (display aid) | WEB verse at same ref, ≥0.90 | **flag + strip**, never refuse → `alignmentCaveat` |

`report.grounded = verdicts.every(v => v.status === "verified")`. A reference-only claim
(`greekQuote: null`) verifies as long as its SBL reference resolves.

## Component 1 — structured synthesis contract (`lib/ai/synthesis.ts`)

The synthesis step stops returning free prose and returns prose **plus a declared `claims` array**,
obtained via the OpenAI Responses API `json_schema` output format (the same strict-mode pattern already
used for the `getPassage` refinement tool).

JSON schema handed to the model:

```jsonc
{
  "answer": "string — the 3-section prose answer (English explanation first)",
  "claims": [
    {
      "reference": "string",      // SBL reference, e.g. "John 1:14"
      "greekQuote": "string|null",
      "gloss": "string|null",
      "englishQuote": "string|null"
    }
  ]
}
```

- **Both synthesis rounds** (direct-answer round, and the post-`getPassage` refinement round) set this
  format. Strict mode requires all properties present; optional fields are expressed as nullable
  (`"string|null"`), mirroring the existing `verseEnd` nullable pattern in `REFINEMENT_TOOL`.
- **`SYNTHESIS_SYSTEM_PROMPT` gains the layered answer policy**: write the readable English explanation in
  `answer`; for every textual claim add an entry to `claims` with the SBL reference, the exact
  `greekQuote` (evidence), a literal `gloss`, and an optional `englishQuote` quoted verbatim from WEB as a
  labeled readable aid (or null). Cite the Greek source. Never invent lexicon entries, manuscript
  evidence, or scholarly citations.
- `output_text` is now a JSON string. Parse it; on parse failure or empty, return `null` exactly like the
  current "no answer" case → caller falls back to the deterministic answer.

```ts
export type SynthesisResult = {
  answer: string;
  claims: GroundingClaim[];        // NEW
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
};
```

## Component 2 — the verifier (`lib/ai/grounding.ts`)

Standalone module, no OpenAI dependency (so it unit-tests in isolation).

```ts
export async function verifyGrounding(claims: GroundingClaim[]): Promise<GroundingReport>;
```

**Per-claim flow:**

1. **Parse the reference.** New helper `parseReference("John 1:14")` →
   `{ book, chapter, verse, verseEnd? }`, reusing `normalizeBook`. Lives in `lib/references.ts` beside
   `formatReference`. Unparseable → `reference-not-found` (claim fails).
2. **Resolve the SBL verse** via existing `getPassage({ corpus: "SBLGNT", book, chapter,
   verseStart: verse, verseEnd })`. A request-scoped `Map` cache keyed by `corpus|book|ch|v` dedupes
   repeat lookups across claims. No SBL verse returned → `reference-not-found` (fails).
3. **Greek quote check.** If `greekQuote` present, normalize both it and the resolved SBL text, compute
   containment-aware similarity. `< 0.90` → `quote-mismatch` (fails). If `greekQuote` is null, a resolving
   reference alone verifies the claim.
4. **English aid check (non-fatal).** If `englishQuote` present, resolve WEB at the same reference;
   missing WEB verse or `< 0.90` → set `alignmentCaveat`, drop the English aid, but keep the claim
   `verified` (WEB is not citation authority).

**Normalization & similarity** (small internal helper, unit-tested independently):

- **Greek:** Unicode NFC → lowercase → strip combining diacritics → normalize final sigma (ς→σ) → drop
  punctuation → collapse whitespace. Diacritic-insensitive comparison avoids false refusals from
  accent/breathing-mark transcription noise while still catching genuine misquotes.
- **English:** lowercase → strip punctuation → collapse whitespace.
- **Containment-aware score:** quotes are usually a *fragment* of the verse, so a whole-verse edit-distance
  ratio would be misleadingly low. Rule: if the normalized quote is a substring of the normalized verse →
  score `1.0`; otherwise slide a window of the quote's length across the verse and take the best
  Levenshtein ratio. A dependency-free `levenshtein()` helper lives in this module (or `lib/text/`).

**Error handling:** if a DB lookup *throws* (infrastructure failure, not a missing verse),
`verifyGrounding` rethrows. The caller catches it and returns the deterministic fallback — an infra
failure must never masquerade as a grounded refusal.

## Component 3 — orchestration, refusal, persistence

### `lib/ai/assistant.ts` — `answerBibleQuestion`

The only structural edit. After live synthesis returns a result with `claims`:

```
verifyGrounding(result.claims)
  → grounded:      return the live answer (grounded: true, groundingReport in metadata)
  → not grounded:  return a structured REFUSAL answer (grounded: false, report attached)
  → throws (DB infra): caught → deterministic fallback (grounded: true)
```

Untouched, all **grounded by construction** (echo only real retrieved corpus text):
`isLiveAssistantEnabled() === false`, synthesis returns `null`, synthesis throws.

### Refusal answer — `buildRefusalAnswer(prompt, evidence, report)`

- **Body:** the structured Silence-Protocol message — *"Insufficient textual evidence. TextLab drafted an
  answer but could not verify its citations against the SBLGNT, so it withheld the response rather than
  risk an unsupported claim."* — followed by the real retrieved evidence (`evidence.formattedEvidence`),
  which is grounded and still useful.
- **Citations:** `evidence.citations` (verified retrieval citations), not the model's failed ones.
- **`toolTrace`:** a `{ tool: "grounding", ... }` entry listing which claims failed and why
  (`reference-not-found` / `quote-mismatch` + scores), so the codex-gutter sidebar shows the reasoning.

### New signal — `grounded`

Rather than overloading `mode`, add one field to `AssistantAnswer`:

```ts
grounded: boolean;                 // false only on a Silence-Protocol refusal
groundingReport?: GroundingReport; // verdicts for the sidebar / persistence
```

`mode` stays `"live" | "fallback"` (a refusal is still a `"live"` pipeline result, just ungrounded).
Fallback and non-live answers set `grounded: true`. Rationale: a separate boolean is less invasive than a
third `mode` value (no new state to thread through every `mode` switch) and semantically cleaner.

### `components/AiAssistant.tsx`

Keys off `grounded === false` to render a "Withheld — insufficient evidence" banner instead of the answer
body. `ModeBadge` is unchanged.

### `lib/ai/sessions.ts` — persistence (the Approach A payoff)

`AssistantMessageMetadata` gains `grounded` and `groundingReport`. Because verification runs before
`finishAssistantExchange`, the stored `AiMessage` row contains the withheld refusal — never the
fabricated draft. A withheld answer reads back as a refusal with its reasoning attached: an honest record
that the assistant declined, not a hallucination sitting in history.

## What gets persisted on a withheld answer

- `content`: the refusal message + the real retrieved (verified) evidence.
- `metadata.grounded`: `false`.
- `metadata.groundingReport`: the verdicts (which claims failed and why), also feeding the sidebar trace.

## Testing strategy (TDD — tests precede implementation)

Coverage must stay above the gate (lines/statements/functions/branches 80/80/75/65).

**`tests/unit/lib/ai/grounding.test.ts`** (pure; mocks `getPassage`/`prisma`):
- Greek quote that is an exact substring of the SBL verse → `verified`, score `1.0`.
- Greek quote with diacritic/breathing-mark noise but otherwise identical → `verified` (≥0.90 after normalization).
- Greek quote genuinely not in the verse → `quote-mismatch` → fails → `grounded: false`.
- Reference resolving to no SBL verse → `reference-not-found` → fails.
- Unparseable reference string → `reference-not-found` → fails.
- Reference-only claim (`greekQuote: null`) with a real SBL verse → `verified`.
- WEB aid stripped + caveat (not refused): valid Greek spine + an `englishQuote` that mismatches WEB / WEB
  verse absent → claim stays `verified`, verdict carries `alignmentCaveat`, English aid dropped.
- Verse-range reference → matches against joined SBL text.
- Dedupe: two claims on the same reference → one DB lookup (assert cache).
- DB lookup throws → `verifyGrounding` rethrows (infra surfaces, not a silent refusal).
- `grounded` true only when every verdict is `verified`.

**Normalization + similarity helper** (co-located or `lib/text`): substring → 1.0; sliding-window best
ratio; Greek diacritic folding; final-sigma normalization; empty-quote guard.

**`tests/unit/lib/references.test.ts`** (extend) — `parseReference`: `"John 1:14"`, `"1 John 2:23"`
(numbered book), `"Rom 8:1-4"` (range), book aliases, malformed inputs → null.

**`tests/unit/lib/ai/synthesis.test.ts`** (extend) — structured JSON parsed into `{ answer, claims }`;
malformed JSON → `null` (→ fallback); the post-`getPassage` refinement round still emits structured output.

**`tests/unit/lib/ai/assistant.test.ts`** (extend) — grounded draft → live answer, `grounded: true`;
ungrounded draft → refusal body, `grounded: false`, `mode: "live"`, evidence + `groundingReport` present,
bad draft text absent; `verifyGrounding` throws → deterministic fallback; non-live & null-synthesis paths
→ `grounded: true`.

**`tests/unit/components/AiAssistant`** — a `grounded: false` answer renders the "withheld" banner, not the draft.

**`tests/unit/api/assistant-route.test.ts`** (extend) — a withheld answer persists with `grounded: false`
metadata (the ordering guarantee).

**Acceptance (`scripts/acceptance-test.js`)** — add one end-to-end interaction asking a question
engineered to force a fabricated citation, asserting the UI shows the withheld/insufficient-evidence
response. (Acceptance assumes the full SBLGNT corpus — see memory note.)

## Files touched

- **New:** `lib/ai/grounding.ts` (+ test), normalization/similarity helper (+ test).
- **Modified:** `lib/ai/synthesis.ts` (structured output + prompt), `lib/ai/assistant.ts` (orchestration,
  refusal, `grounded` field), `lib/ai/modelRouter.ts` or `assistant.ts` (where `AssistantAnswer` /
  related types live), `lib/ai/sessions.ts` (metadata), `lib/references.ts` (`parseReference`),
  `components/AiAssistant.tsx` (withheld banner), `scripts/acceptance-test.js`.
- **Docs (per CLAUDE.md):** update `docs/PROJECT_STATE.md`, `ReadMe.md`, and `docs/HiFi-exegesis-nt-roadmap.md`
  (Phase 2 → done) after implementation; `docs/security-register.md` only if a security-relevant change lands.

## Out of scope (deferred)

- SBL ↔ RP/Byzantine variation-unit reconciliation and verse-numbering mapping.
- Multiple / future English translations (shape allows; only WEB wired now).
- Claim-level NLI/entailment faithfulness scoring (that is Phase 6, the evaluation harness).
- Streaming the synthesized answer.

## Verification (Definition of Done)

- `npm run verify` (lint + tsc + build + coverage gate) exits 0.
- `npm run test:integration` and `npm run test:acceptance` pass against the Neon test branch.
- Manual: a word-study and a passage question return grounded answers with SBL-anchored citations; a
  deliberately unsupported question triggers the withheld "insufficient textual evidence" response rather
  than a fabricated answer.
