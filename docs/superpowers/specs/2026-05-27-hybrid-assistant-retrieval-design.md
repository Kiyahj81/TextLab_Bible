# Hybrid Assistant Retrieval (Paradigm C) — Design

*Date:* 2026-05-27
*Author:* drafted with Claude (kiyahj81)
*Status:* Draft — alternative to `2026-05-27-agentic-assistant-tool-calling-design.md` (Paradigm B)

---

## 0. Read this first — how this differs from Paradigm B

| Dimension | Paradigm B (agentic) | Paradigm C (hybrid) |
|---|---|---|
| Where retrieval decisions are made | Model decides which tools to call | Deterministic preprocessor decides; model refines |
| Pre-retrieval scope | Light (references + Greek words) | Heavy (refs + Greek + English topic words + intent classification) |
| Model tool budget | 6 tools, ~5 iterations | 1 tool (`getPassage`), ~1 refinement call |
| Determinism | Low — same prompt may route differently | High — same prompt produces the same evidence |
| Cost per request | 1–5 OpenAI calls | 1–2 OpenAI calls |
| Latency p95 (estimated) | 15–25s worst case | 5–10s worst case |
| Code complexity | Loop in agentic layer, simple preprocessor | Heavy preprocessor, simple synthesis layer |
| Failure mode on novel question shapes | Model improvises tool calls | Falls back to keyword/topic search; may miss |
| Extensibility for new question types | Free (model adapts) | Each new pattern needs a new detector |

**Mental model:** B trusts the model to drive retrieval; C does the driving deterministically and treats the model as a synthesizer with a small refinement tool. C trades flexibility for cost, latency, and predictability.

## 1. Context

Same problem statement as Paradigm B: the existing five-branch dispatch table in `lib/ai/assistant.ts` is a scaffold that cannot answer questions outside its narrow trigger phrases. The fix is structural. The question is *how* much of the retrieval planning the model should do versus how much code should do.

Paradigm B assumes the model is the right place to plan retrieval — fewer brittle code patterns, more flexibility. Paradigm C assumes deterministic code can cover the vast majority of Bible-study question shapes with regex/lookup work, and the model should stick to what it's better at: writing the answer.

## 2. Goal

Replace the dispatch table with a **deterministic-first retrieval pipeline**: extract every retrievable signal from the prompt (references, Greek words, English content words, question intent), run the matching tools in parallel, and hand a rich evidence packet to the model along with a single `getPassage` tool it can use to fetch additional context if needed. Model has tool access but is instructed to use it sparingly.

### 2.1 Non-goals

Same as B §3.1:

- No new retrieval functions in `lib/search.ts`
- No streaming
- No scholarly-mode escalation
- No auth / rate-limit / validation changes

## 3. Architecture

### 3.1 Component map

```
POST /api/assistant
  └── answerBibleQuestion(prompt)            [lib/ai/assistant.ts]
        ├── routeAssistantPrompt(prompt)     [unchanged]
        ├── extractSignals(prompt)           [NEW: lib/ai/signals.ts]
        │     ├── detectReferences()         [regex over ntBooks aliases]
        │     ├── detectGreekWords()         [Unicode ranges]
        │     ├── detectTopicWords()         [stopword filter + content nouns]
        │     ├── detectIntent()             [rule-based: word-study/passage/topic/morph/lookup]
        │     └── detectMorphCodes()         [regex \b[A-Z]-[A-Z0-9-]+\b]
        ├── runRetrievalPlan(signals)        [NEW: lib/ai/retrievalPlanner.ts]
        │     ├── Build list of tool calls from detected signals
        │     ├── Execute all tools in parallel
        │     └── Return EvidencePacket { citations, toolTrace, formattedEvidence }
        └── synthesizeWithRefinement(prompt, evidence, routing)   [NEW: lib/ai/synthesis.ts]
              ├── Single OpenAI call with `tools: [getPassage]` and `tool_choice: "auto"`
              ├── If model emits a getPassage call → execute, append result, second model call
              ├── If model returns text directly → done
              └── Hard cap: 1 refinement round
```

### 3.2 Signal extraction (the heavy layer)

`lib/ai/signals.ts` exports `extractSignals(prompt: string): Signals` which returns:

```ts
type Signals = {
  references: ParsedReference[];      // [{ book: "Rom", chapter: 7, verseStart?, verseEnd? }]
  greekWords: string[];               // ["νόμος", "λόγος"] — deduplicated
  topicWords: string[];               // ["law", "righteousness"] — content nouns, stopwords removed
  morphCodes: { code: string; mode: "exact" | "prefix" }[];
  intent: Intent;                     // "word-study" | "passage-study" | "topic-survey" | "morphology" | "comparison" | "general"
  book?: string;                      // single dominant book if any, used to scope topic/Greek searches
};
```

Each detector is independent and deterministic:

- **`detectReferences`** — regex over the existing `ntBooks` alias list (already used by `detectBookFromPrompt`). Captures shapes: `"Romans 7"`, `"Rom 7:1"`, `"Rom 7:1-6"`, `"Romans 7:1–6"` (with en-dash), `"1 Cor 13"`, `"John 3:16"`. Word-boundary-anchored.
- **`detectGreekWords`** — `/[Ͱ-Ͽἀ-῿]+/gu`. Returns unique normalized Greek runs. Filters out single-character runs (likely noise).
- **`detectTopicWords`** — tokenize, lowercase, remove stopwords (a hand-curated list of ~150 common English words: question words, articles, pronouns, common verbs), keep nouns and verbs of length ≥ 3. Map common English Bible terms to Greek lemmas via a `ENGLISH_TO_GREEK_LEMMA` lookup table (~30 entries: "law" → "νόμος", "love" → "ἀγάπη", "faith" → "πίστις", "grace" → "χάρις", "spirit" → "πνεῦμα", "flesh" → "σάρξ", etc.).
- **`detectMorphCodes`** — regex `\b[A-Z]-[A-Z0-9-]+\b`. Distinguishes exact codes (e.g. `N-NSM`) from prefixes (e.g. `V-` for "any verb").
- **`detectIntent`** — rule-based classification by keyword patterns:
  - "what does X mean" / "how is X used" / "senses of X" → `word-study`
  - "Romans 7" / "show me" / "read" → `passage-study`
  - "verses about X" / "find X" → `topic-survey`
  - "imperatives" / "participles" / morph code present → `morphology`
  - "difference between" / "compare" → `comparison`
  - default → `general`

The intent influences the retrieval plan but doesn't gate it — multiple signals may produce overlapping tool calls.

### 3.3 Retrieval planner

`lib/ai/retrievalPlanner.ts:runRetrievalPlan(signals): Promise<EvidencePacket>` translates signals into a concrete plan of tool calls and executes them in parallel. The mapping:

| Signal | Tool call(s) |
|---|---|
| `references[i]` | `getPassage(SBLGNT, ...)` and `getPassage(WEB, ...)` — both corpora |
| `greekWords[i]` | `searchLemma({ lemma, book: signals.book, pageSize: 20 })` |
| `topicWords[i]` mapped to a Greek lemma via `ENGLISH_TO_GREEK_LEMMA` | `searchLemma({ lemma: <mapped>, book, pageSize: 20 })` |
| `topicWords[i]` with no Greek mapping | `searchKeyword({ query: <word>, book, pageSize: 10 })` |
| `morphCodes[i]` | `searchMorphology({ morphCode, matchMode, book, pageSize: 20 })` |
| Intent = `word-study` and no Greek words detected | Skip — answer relies on topic-word retrieval |
| Intent = `topic-survey` and no signals at all | `getTopLemmas({ book: signals.book, limit: 10 })` if a book is detected |

All tool calls are executed via `Promise.allSettled` so a failure in one doesn't abort the rest. Failures append an error entry to `toolTrace` but don't throw.

The planner deduplicates redundant calls (same lemma + book = one call) and caps the total number of tool calls at `MAX_PLANNED_CALLS = 8` to bound cost when a prompt mentions many terms.

The output `EvidencePacket`:

```ts
type EvidencePacket = {
  citations: AssistantCitation[];
  toolTrace: ToolTraceEntry[];
  formattedEvidence: string;   // Pre-rendered, ready to inline in the model's user payload
};
```

`formattedEvidence` is a structured multi-section block: each tool call gets a labeled heading + a compact list of results (capped at 10 lines per section). This is what the model actually sees — the citations array is parallel data for the API response.

### 3.4 Synthesis with limited refinement

`lib/ai/synthesis.ts:synthesizeWithRefinement(prompt, evidence, routing)` makes a single OpenAI Responses API call with:

- `instructions`: a synthesis-focused system prompt that says: *retrieval has been done, use the formatted evidence below, you may call `getPassage` exactly once if a critical piece of context is missing, then write the final three-section answer.*
- `tools`: exactly one — `getPassage` with the same schema as in the B spec
- `tool_choice`: `"auto"` — model decides whether to call

If the model emits a `getPassage` call:
1. Execute it
2. Append the `function_call_output` item
3. Make a second model call (no tools registered — strict synthesis)
4. Return the final answer

If the model emits text directly: return immediately.

Hard cap of 1 refinement round. No iteration loop. If the model tries to call `getPassage` again in the second call (it can't — no tools registered), the cap is automatically enforced.

### 3.5 Fallback paths

| Condition | Behavior |
|---|---|
| `OPENAI_API_KEY` unset | Build a deterministic answer from the `formattedEvidence` block using a template. Same three-section structure. |
| Both OpenAI calls throw | Same as no API key. Trace records the error. |
| `extractSignals` returns no signals AND `OPENAI_API_KEY` unset | Return a clean "no evidence found" template answer. |
| Tool call in planner throws | `Promise.allSettled` catches; trace entry records error; continue with remaining results. |

### 3.6 Synthesis system prompt

```
You are an AI Bible study assistant inside TextLab Bible.

Retrieval has already been performed. Below the user prompt you will see a
"Retrieved evidence" block containing the verses, lemmas, and tokens that
match the prompt. Use only this evidence to answer.

If a critical piece of context is missing — for example, the surrounding
verses of a key passage — you may call the `getPassage` tool exactly once.
Otherwise, write the answer directly.

Structure the answer in three sections:
1. Textual observations
2. Interpretive suggestion
3. Application/reflection

Cite every textual claim with book, chapter, verse, and corpus. Never
invent lexicon entries, manuscript evidence, or scholarly citations.
```

## 4. Observability

Same `ToolTraceEntry[]` shape as today. The planner emits one entry per executed tool call. Synthesis emits:

- `{ tool: "openai.responses.create", args: { model, phase: "synthesis" } }`
- `{ tool: "getPassage", args: {...} }` if the model refined
- `{ tool: "openai.responses.create", args: { model, phase: "refinement-synthesis" } }` if there was a second call

The codex-gutter sidebar already renders these; no UI changes.

## 5. Tool definition (model-facing)

Only `getPassage` is exposed to the model:

```ts
const REFINEMENT_TOOL: FunctionTool = {
  type: "function",
  name: "getPassage",
  strict: true,
  description: "Fetch additional verse text from SBLGNT or WEB. Use ONLY when the retrieved evidence is missing critical context (e.g., you need verses immediately before or after a passage already cited). Do not use to re-fetch what's already in the evidence block.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      corpus: { type: "string", enum: ["SBLGNT", "WEB"] },
      book: { type: "string", description: "OSIS id or book name." },
      chapter: { type: "integer", minimum: 1 },
      verseStart: { type: "integer", minimum: 1 },
      verseEnd: { type: "integer", minimum: 1, description: "Inclusive end verse. Omit to fetch a single verse." }
    },
    required: ["corpus", "book", "chapter", "verseStart"]
  }
};
```

Six tools exist server-side (same as in the B spec), but only `getPassage` is registered with the model. The other five (`searchLemma`, `searchKeyword`, `searchMorphology`, `getTopLemmas`, `findLemmaExamples`) are called by the planner, not by the model.

## 6. Code changes

### 6.1 New files

- `lib/ai/signals.ts` — `extractSignals` + the individual detectors + the `ENGLISH_TO_GREEK_LEMMA` lookup table + stopword list.
- `lib/ai/retrievalPlanner.ts` — `runRetrievalPlan` + deduplication + parallel execution + `formattedEvidence` rendering.
- `lib/ai/synthesis.ts` — `synthesizeWithRefinement` + `buildDeterministicFallback`.
- `tests/unit/lib/ai/signals.test.ts` — detector unit tests.
- `tests/unit/lib/ai/retrievalPlanner.test.ts` — planning + deduplication + parallel execution tests.
- `tests/unit/lib/ai/synthesis.test.ts` — happy path + refinement path + fallback tests.

### 6.2 Modified files

- `lib/ai/assistant.ts`:
  - Delete `branches`, `importantWordsBranch`, `lemmaAliasBranch`, `morphologyBranch`, `passageBranch`, `keywordFallback`, `lemmaAliases`, `isImportantWordsPrompt`, `extractMorphCode`, `passageCitations`.
  - Keep `detectBookFromPrompt` (used inside `extractSignals`), `AssistantCitation`, `AssistantAnswer`, `withMarkdown`.
  - Replace `answerFromLocalRetrieval` with: `extractSignals` → `runRetrievalPlan` → `synthesizeWithRefinement` (or fallback).
- `lib/ai/modelRouter.ts`:
  - Drop `synthesizeWithDefaultModel` entirely — it's replaced by `synthesis.ts`.
  - Keep `routeAssistantPrompt`, `getMaxOutputTokens`, `getModelForRole`, `isLiveAssistantEnabled`.
- `tests/unit/lib/ai/modelRouter.test.ts`:
  - Move synthesizer tests to `synthesis.test.ts`.
- `tests/unit/lib/ai/assistant.test.ts`:
  - Replace branch-routing tests with end-to-end tests through the new pipeline (mocked Prisma + mocked `responses.create`).

### 6.3 Removed files

- `lib/ai/systemPrompt.ts` — `aiSystemPrompt` is no longer imported by anything. (Same recommendation as the B spec; equally optional.)

## 7. Testing strategy

### 7.1 Unit — signals

- **References**: `"Romans 7"`, `"Rom 7:1"`, `"Rom 7:1-6"`, `"Rom 7:1–6"` (en-dash), `"1 Cor 13"`, `"John 3:16"`, mixed `"In Romans 7 and 1 Cor 13"` → 2 references. Anti-cases: `"romance languages"`, `"from the start"`.
- **Greek**: `"What does νόμος mean?"` → `["νόμος"]`. `"compare λόγος and σάρξ"` → `["λόγος", "σάρξ"]`. `"the word ὁ"` → `[]` (single-char filter).
- **Topic words**: `"What is the role of law in Romans?"` → `["law", "role"]` (or just `["law"]` after the Greek-lemma mapping pulls "law"). `"How does Paul use πίστις?"` → no topic words for "Paul" (filtered as proper noun if we add that filter; alternatively, "Paul" is allowed but doesn't map to a lemma so it becomes a keyword search — flag for review).
- **Morph codes**: `"imperatives in 1 Peter"` → `[{ code: "V-M", mode: "prefix" }]` (via intent-driven mapping for the word "imperatives"); `"V-PNI-3S"` literal → `[{ code: "V-PNI-3S", mode: "exact" }]`.
- **Intent**: each rule's positive and negative case.

### 7.2 Unit — planner

- **Basic plan**: signal `{ references: [Rom 7], greekWords: ["νόμος"] }` → 4 tool calls (`getPassage(SBLGNT, Rom 7, 1)`, `getPassage(WEB, Rom 7, 1)`, `searchLemma(νόμος, Rom)`, plus the keyword search if any).
- **Deduplication**: same lemma appears in `greekWords` and `topicWords` (mapped) → one call only.
- **Parallel execution**: assert all tools fire concurrently (mock with timeouts; total wall time ≈ longest tool, not sum).
- **Failure isolation**: one tool throws; remaining results still in citations.
- **Cap enforcement**: 12 detected signals → only first 8 fire (`MAX_PLANNED_CALLS`).
- **Empty signals + book detected**: fallback to `getTopLemmas` if intent is topic-survey.
- **`formattedEvidence` rendering**: produces a structured block, capped at 10 lines per section, with the right headings.

### 7.3 Unit — synthesis

- **Direct answer path**: model emits text only → return that text + the planner's citations.
- **Refinement path**: model emits one `getPassage` call → execute → second model call → return.
- **Refinement-loop attempt**: model emits two `getPassage` calls in the first response → execute the first, ignore (and trace-warn) about the second. Or alternatively: execute all in the first batch but no more (decision: execute all in first batch, since refinement budget is per-round not per-call. Update §3.4 if this is the chosen interpretation.). **Open question — see §10.**
- **Both calls throw**: deterministic fallback fires.
- **Refinement throws but first call succeeded**: return the first answer's `output_text` if non-empty, else fallback.

### 7.4 Integration

Unchanged from B spec — existing `tests/integration/db-ownership.test.ts` is unaffected.

### 7.5 Acceptance

Same change as B: update `scripts/acceptance-test.js` to assert at least one citation for the νόμος-in-Romans-7 query.

### 7.6 Coverage gate

Same thresholds. New code surface area is larger than B (more deterministic logic = more branches), so plan to write a few more targeted tests around the detectors.

## 8. Rollback / feature gate

Same gate name (`TEXTLAB_ASSISTANT_DISABLE_AGENTIC=1`) but different effect: in C, the disabled-agentic path skips the refinement tool call and emits a single-shot synthesis call with no tools. The deterministic planner still runs, so evidence is still retrieved. Result: same answer quality as the happy path minus any model-driven refinement. Cheap fast-rollback option.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stopword + topic-word extraction misses obviously-relevant terms | Hand-curated `ENGLISH_TO_GREEK_LEMMA` covers ~30 highest-frequency terms; extend as needed. Keyword search is the safety net. |
| `ENGLISH_TO_GREEK_LEMMA` becomes stale or inaccurate | Acceptable for v1; iterate based on real queries. Eventually replaceable with embedding-based lookup. |
| Many topic words → many tool calls → DB load | `MAX_PLANNED_CALLS = 8` caps total. Each call is paginated to `pageSize: 20`. |
| Detected references contain typos | Regex anchors on known book aliases; typos won't match. They fall through to topic-word search. |
| Model wastes the refinement call on already-known content | Tool description is explicit ("do not use to re-fetch what's already in the evidence block"). If it still happens, the trace shows it and we can tune the prompt. |
| New question shape not anticipated by the detectors | Falls through to `searchKeyword` for the prompt's content words. Worse than B at this case — B would let the model improvise. |
| `formattedEvidence` block grows too large | Per-section 10-line cap. Total block soft cap ~6KB. Truncate with `…(N more)` markers. |

## 10. Open questions

1. **Should multiple `getPassage` calls in one model response be honored?** §3.4 says "exactly one refinement call." §7.3 flags this as ambiguous. Two interpretations: (a) execute all calls in the first response, then no more (refinement *round* budget); (b) execute only the first, ignore the rest (refinement *call* budget). Recommend (a) — it gives the model room to fetch two related passages in parallel without paying for an extra round-trip.
2. **Should "Paul" / proper-noun filtering be added to topic-word extraction?** Proper nouns rarely map to useful searches. Recommend yes — exclude tokens that match a known proper-noun list (people, places).
3. **Should the `ENGLISH_TO_GREEK_LEMMA` table live in a separate JSON file for non-developer editing?** Probably yes if we expect to grow it past ~50 entries. Recommend split into `lib/ai/data/english-to-greek.json` if it grows.
4. **Should `aiSystemPrompt` and `lib/ai/systemPrompt.ts` be deleted?** Same open question as B §11.1.

## 11. Estimated effort

- New files (`signals.ts`, `retrievalPlanner.ts`, `synthesis.ts`): ~600 LOC
- Tests for those files: ~700 LOC (more deterministic logic = more test cases)
- Modified files (`assistant.ts`, `modelRouter.ts`): net deletion of ~200 LOC, addition of ~60 LOC
- `ENGLISH_TO_GREEK_LEMMA` initial table: ~30 hand-curated entries

Total: ~2-3 days of focused work, plus another day for tuning detectors and the lemma table against acceptance-test traffic. Single PR, no migrations.

## 12. Decision: when to pick C over B

Pick **C** if:
- You want predictable cost (1–2 OpenAI calls every time, no agentic blow-up)
- You want predictable latency (no model thinking + retrying tools)
- You want deterministic, debuggable behavior — same prompt always produces the same retrieval
- You prefer adding patterns by writing code over trusting the model to generalize
- The audience is technical users who'd rather see the system's actual reasoning than have it disguised inside a model

Pick **B** if:
- You want the system to handle novel question shapes without code changes
- You're comfortable with variable cost/latency in exchange for flexibility
- You expect the assistant pipeline to be reused later for scholarly mode (where multi-step retrieval is unavoidable)
- You value architectural simplicity (one loop, one set of tools) over comprehensive deterministic coverage

Pick **a sequence** if you want both: ship C first (fast, cheap, robust for the 80% case), revisit B in 3–6 months when you have real usage data showing where the deterministic detectors fail. C's planner code becomes the "pre-retrieval" layer of B with minimal rework.
