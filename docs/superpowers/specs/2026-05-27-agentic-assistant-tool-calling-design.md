# Agentic Assistant Tool-Calling (Paradigm B)— Design

*Date:* 2026-05-27
*Author:* drafted with Claude (kiyahj81)
*Status:* Draft — awaiting review

---

## 1. Context

The current assistant pipeline (`lib/ai/assistant.ts` → `answerFromLocalRetrieval`) is a dispatch table of five hardcoded branches:

1. `importantWordsBranch` — fires only on prompts containing "important"/"top"/"key" **and** "word"/"lemma"/"theme"
2. `lemmaAliasBranch` — fires only for three hardcoded lemmas (λόγος, δικαιοσύνη, πιστεύω)
3. `morphologyBranch` — fires only on prompts containing "morph" or "imperative"
4. `passageBranch` — fires only on prompts containing "john 1" or the literal word "passage"
5. `keywordFallback` — always fires; passes the **entire user question** as a literal keyword search

This shape was built as a scaffold for Milestone 2.5 to prove the "local retrieval → synthesis" contract. It was never extended into a working retrieval system. Any question that doesn't trip one of the four narrow triggers — including questions about Greek words not in the three-item alias list, or references outside John 1 — falls through to `keywordFallback`, which then does the equivalent of a SQL `LIKE '%<full natural-language question>%'` over verse text. That always returns zero results for analytical questions, so the synthesizer correctly refuses to invent answers from empty evidence.

The original `aiSystemPrompt` already says *"first call the relevant search or passage tool"* — that instruction was written for an agentic system where the model has registered tools to choose from. The tools were never registered. The synthesis call in `lib/ai/modelRouter.ts:synthesizeWithDefaultModel` makes a single Responses API call with **no `tools:` array**. The instruction has had no consumer until this design.

## 2. Problem statement

**The assistant cannot answer questions that aren't already in the dispatch table.** The system is incapable of answering "What are the different senses in which Paul uses νόμος in Romans 7?" — a textbook word-study question — because:

- νόμος is not in the 3-item alias list, so `lemmaAliasBranch` skips
- The prompt says "Romans 7" not "John 1", so `passageBranch` skips
- `keywordFallback` searches verse text for the full English question, finding 0 results

The fix is structural, not parametric: adding more hardcoded branches/aliases is a treadmill. Bible study generates an unbounded variety of question shapes; deterministic pattern-matching cannot cover them.

## 3. Goal

Replace the pattern-matching dispatch with **agentic tool-calling**: register the existing retrieval functions as OpenAI Responses API tools and let the model decide which tools to call, with what arguments, in what sequence. The model becomes the planner; the retrieval functions stay as plain server-side functions, unchanged in behavior.

### 3.1 Non-goals

- **No new retrieval functions.** This design reuses the existing `getPassage`, `searchKeyword`, `searchLemma`, `searchMorphology`, `getTopLemmas`, `findLemmaExamples`. New retrieval shapes (semantic/embedding search, cross-corpus comparison) are out of scope.
- **No streaming.** Responses come back atomically, same as today. Streaming is a separate UX improvement.
- **No scholarly-mode escalation.** That is Step 3 in `PROJECT_STATE.md` and stays decoupled — once tool-calling lands, scholarly mode becomes "same pipeline, bigger model" rather than "rebuild pipeline."
- **No new auth / rate-limit / validation work.** All existing guards stay; the route signature does not change.

## 4. Architecture

### 4.1 Component map

```
POST /api/assistant
  └── answerBibleQuestion(prompt)           [lib/ai/assistant.ts]
        ├── routeAssistantPrompt(prompt)    [unchanged — still detects scholarly cues]
        ├── pre-retrieval (deterministic)   [NEW: detect references / Greek words, fetch starter evidence]
        ├── runAgenticSynthesis(...)        [NEW: lives in lib/ai/agenticLoop.ts]
        │     └── loop:
        │           openai.responses.create({ tools, input, ... })
        │           ↓
        │           ResponseFunctionToolCall[] ?
        │             ├─ yes → execute tools, append function_call_output items, iterate
        │             └─ no  → final answer in response.output_text → break
        └── fallback path (no API key OR loop failure)
              └── deterministic minimal retrieval (the pre-retrieval evidence alone, formatted)
```

The dispatch table in `lib/ai/assistant.ts` — including `importantWordsBranch`, `lemmaAliasBranch`, `morphologyBranch`, `passageBranch`, `keywordFallback`, and the `branches` array — is **deleted**. `lemmaAliases`, `isImportantWordsPrompt`, `extractMorphCode` are deleted. `detectBookFromPrompt` is **kept** (used by pre-retrieval).

### 4.2 Tool registration

Six tools are registered with the Responses API. Each is a `FunctionTool` with `strict: true` for JSON-schema-enforced argument validation. Names are kept identical to the existing function names so the existing `toolTrace` log shape stays comparable.

| Tool | Backing function | Purpose |
|---|---|---|
| `getPassage` | `lib/search.ts:getPassage` | Fetch verse text for a reference range from SBLGNT or WEB |
| `searchKeyword` | `lib/search.ts:searchKeyword` | Substring search over English verse text (or any corpus) |
| `searchLemma` | `lib/search.ts:searchLemma` | All token occurrences of a Greek lemma (optionally scoped to book/chapter) |
| `searchMorphology` | `lib/search.ts:searchMorphology` | All tokens matching a morphology code or prefix |
| `getTopLemmas` | `lib/search.ts:getTopLemmas` | Most frequent content lemmas in a book |
| `findLemmaExamples` | `lib/search.ts:findLemmaExamples` | Sample tokens per lemma across a list |

Each tool's JSON schema mirrors its input type in `lib/search.ts`. Concrete schemas are given in §6.

### 4.3 The tool-call loop

`lib/ai/agenticLoop.ts:runAgenticSynthesis` owns the loop. Pseudocode:

```ts
async function runAgenticSynthesis(params: {
  prompt: string;
  starterEvidence: StarterEvidence;   // pre-retrieved citations + tool trace
  routing: RoutingDecision;
}): Promise<AssistantAnswer | null> {
  const tools = TOOL_DEFINITIONS;             // §6
  const inputItems: ResponseInputItem[] = [
    { role: "user", content: [{ type: "input_text", text: buildInitialUserPayload(params) }] }
  ];
  const toolTrace: ToolTraceEntry[] = [...params.starterEvidence.toolTrace];
  const citations: AssistantCitation[] = [...params.starterEvidence.citations];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.responses.create({
      model: params.routing.modelUsed,
      instructions: SYNTHESIS_SYSTEM_PROMPT,
      max_output_tokens: getMaxOutputTokens(),
      tools,
      input: inputItems
    });

    const toolCalls = response.output.filter(item => item.type === "function_call");

    if (toolCalls.length === 0) {
      // Model produced its final answer.
      return buildAnswer(response.output_text, citations, toolTrace, params.routing);
    }

    // Append the model's tool-call items so the next iteration sees them.
    inputItems.push(...toolCalls);

    // Execute each tool call, capturing citations + trace, and append the
    // corresponding function_call_output items.
    for (const call of toolCalls) {
      const { output, newCitations, traceEntry } = await executeToolCall(call);
      toolTrace.push(traceEntry);
      citations.push(...newCitations);
      inputItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output)
      });
    }
  }

  // Iteration cap reached without a final answer.
  return null;   // caller falls back to deterministic path
}
```

**Configuration constants** (defined as module-level `const` in `lib/ai/agenticLoop.ts`; not env-tunable in v1):

- `MAX_ITERATIONS = 5` — caps total round-trips. Cheap to bump later if needed; starting conservative.
- `MAX_TOOL_RESULT_CHARS = 8_000` — each tool's serialized result is truncated to this size before being sent back. Prevents context explosion when `searchLemma` returns 100+ tokens.
- `MAX_RESULTS_PER_TOOL_CALL = 20` — passed as `pageSize` to paginated tools. Model can request another page by calling again with `page: 2`.

### 4.4 Pre-retrieval (deterministic starter evidence)

Before invoking the agentic loop, run a single deterministic pass that catches the two highest-signal patterns:

1. **Reference detection.** Regex `\b(book)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?\b` against a vocabulary of book aliases (we already have `ntBooks` aliases used by `detectBookFromPrompt`). If a reference like "Romans 7", "John 3:16", "Rom 7:1-6" is found, run `getPassage` for both SBLGNT and WEB.
2. **Greek word detection.** Regex over the prompt for runs of Greek Unicode characters (`[Ͱ-Ͽἀ-῿]+`). For each unique Greek run found, run `searchLemma` scoped to any detected book.

The results are passed to the agentic loop as `starterEvidence` and shown to the model in the initial user payload as *"Already retrieved on your behalf:"* — so the model knows it doesn't need to re-call those tools but can if it wants to refine.

This serves two purposes:

- **Happy-path speed.** A query like "νόμος in Romans 7" gets the right evidence before the model even runs, so the model often answers in a single round-trip with no additional tool calls.
- **Fallback evidence.** If the agentic loop fails or `OPENAI_API_KEY` is unset, the starter evidence becomes the *only* evidence. A minimal deterministic answer is built from it (similar shape to today's branch responses).

### 4.5 Safety net / fallback paths

| Condition | Behavior |
|---|---|
| `OPENAI_API_KEY` unset | Skip agentic loop. Build a minimal answer from starter evidence (if any) or a "no evidence found" answer. |
| `runAgenticSynthesis` throws | Same as no API key — fall back to starter evidence. Log the error in `toolTrace`. |
| Loop hits `MAX_ITERATIONS` without a final answer | Same fallback. Log a "tool-call cap reached" entry in `toolTrace`. |
| Tool execution throws | Catch per-tool; send back `{ error: <message> }` as the `function_call_output`. The model can recover or surface the error. |

The fallback **never** sees the deleted dispatch table. The two fallback paths (no key, loop failure) both end at: "format the starter evidence into the three-section answer template, or return a clean 'no evidence' template if starter evidence is empty."

### 4.6 Synthesis system prompt

The synthesis system prompt (currently `SYNTHESIS_SYSTEM_PROMPT` in `lib/ai/modelRouter.ts` after the 2026-05-27 bug fix) is updated for the agentic context. The new shape:

- Identifies the assistant's role as a Bible study assistant with registered tools
- Lists each tool by name and what it does (mirror of §6 in compact prose)
- Instructs: call tools to gather evidence, then write the final three-section answer
- Constrains: never invent citations, lexicon entries, or manuscript evidence — every textual claim must point to a verse returned by a tool call or the starter evidence
- Instructs: when starter evidence is present, treat it as the primary retrieved evidence; call additional tools only to fill genuine gaps

The previous synthesizer-only prompt (no tools) is retained as `SYNTHESIS_SYSTEM_PROMPT_LEGACY` for the deterministic fallback path so the fallback's output shape stays consistent with today's.

## 5. Observability

The existing `ToolTraceEntry[]` shape is preserved — the assistant UI already renders it in the codex-gutter sidebar. Each tool call (whether from pre-retrieval or the agentic loop) appends one entry. Entries have:

- `tool`: the tool name (e.g., `"searchLemma"`, `"getPassage"`)
- `args`: the JSON-deserialized arguments the model passed
- `error`: present only if the tool call threw

The agentic loop additionally records two synthetic trace entries per iteration:

- `{ tool: "openai.responses.create", args: { model, iteration, toolCallCount } }` for each loop iteration
- `{ tool: "agenticLoop.completed", args: { iterations, totalToolCalls } }` once the loop exits

This gives a complete audit trail: which tools the model chose, with what arguments, in what order, and how many iterations it took.

## 6. Tool definitions

Each tool definition is a `FunctionTool` with `strict: true`. Schemas are minimal — only the parameters the model needs to set. Defaults (corpus = SBLGNT for token search, pageSize) are filled server-side.

```ts
const TOOL_DEFINITIONS: FunctionTool[] = [
  {
    type: "function",
    name: "getPassage",
    strict: true,
    description: "Fetch verse text for a reference range. Use for any 'show me Romans 7' style request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        corpus: { type: "string", enum: ["SBLGNT", "WEB"] },
        book: { type: "string", description: "OSIS id or book name, e.g. 'Rom', 'Romans', 'John'." },
        chapter: { type: "integer", minimum: 1 },
        verseStart: { type: "integer", minimum: 1 },
        verseEnd: { type: "integer", minimum: 1, description: "Inclusive end verse. Omit to fetch a single verse." }
      },
      required: ["corpus", "book", "chapter", "verseStart"]
    }
  },
  {
    type: "function",
    name: "searchKeyword",
    strict: true,
    description: "Substring search over verse text. Searches all corpora except NET by default (so both SBLGNT and WEB). Use for 'find verses about X' style queries.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Substring to find. Should be a single word or short phrase, not a full question." },
        corpus: { type: "string", enum: ["SBLGNT", "WEB"], description: "Optional corpus filter. Omit to search both." },
        book: { type: "string", description: "Optional OSIS id to scope the search." },
        chapter: { type: "integer", minimum: 1, description: "Optional chapter scope." },
        page: { type: "integer", minimum: 1, description: "1-indexed page for paginated results." }
      },
      required: ["query"]
    }
  },
  {
    type: "function",
    name: "searchLemma",
    strict: true,
    description: "All token occurrences of a Greek lemma in SBLGNT. Use for word-study questions ('how does Paul use νόμος').",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        lemma: { type: "string", description: "Greek lemma in lowercase polytonic form, e.g. 'νόμος', 'πιστεύω'." },
        book: { type: "string", description: "Optional OSIS id to scope the search." },
        chapter: { type: "integer", minimum: 1, description: "Optional chapter scope." },
        page: { type: "integer", minimum: 1 }
      },
      required: ["lemma"]
    }
  },
  {
    type: "function",
    name: "searchMorphology",
    strict: true,
    description: "All tokens matching a morphology code. Use for grammatical pattern queries ('imperatives in 1 Peter').",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        morphCode: { type: "string", description: "Robinson-style morph code, e.g. 'V-P' for present-tense verbs or 'N-NSM'." },
        matchMode: { type: "string", enum: ["exact", "prefix"] },
        book: { type: "string" },
        chapter: { type: "integer", minimum: 1 },
        page: { type: "integer", minimum: 1 }
      },
      required: ["morphCode", "matchMode"]
    }
  },
  {
    type: "function",
    name: "getTopLemmas",
    strict: true,
    description: "Most frequent content lemmas in a book. Use for 'what are the key words in Hebrews' questions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        book: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 25 }
      },
      required: ["book"]
    }
  },
  {
    type: "function",
    name: "findLemmaExamples",
    strict: true,
    description: "Sample tokens per lemma across a list. Use after getTopLemmas to fetch examples.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        lemmas: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        book: { type: "string" },
        perLemma: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: ["lemmas"]
    }
  }
];
```

## 7. Code changes

### 7.1 New files

- `lib/ai/agenticLoop.ts` — `runAgenticSynthesis`, `executeToolCall`, the tool dispatch table, constants.
- `lib/ai/preRetrieval.ts` — `detectReferences`, `detectGreekWords`, `runPreRetrieval`. Returns `StarterEvidence = { citations, toolTrace }`.
- `lib/ai/toolDefinitions.ts` — the `TOOL_DEFINITIONS` array and per-tool JSON Schema constants.
- `tests/unit/lib/ai/agenticLoop.test.ts` — tool-call loop unit tests against mocked `responses.create`.
- `tests/unit/lib/ai/preRetrieval.test.ts` — reference/Greek-word extraction unit tests.

### 7.2 Modified files

- `lib/ai/assistant.ts`:
  - Delete `branches`, `importantWordsBranch`, `lemmaAliasBranch`, `morphologyBranch`, `passageBranch`, `keywordFallback`, `lemmaAliases`, `isImportantWordsPrompt`, `extractMorphCode`, `passageCitations`.
  - Keep `detectBookFromPrompt`, `AssistantCitation`, `AssistantAnswer`, `withMarkdown`.
  - Replace `answerFromLocalRetrieval` with a new flow: `runPreRetrieval` → either `runAgenticSynthesis` (live) or `buildDeterministicFallback` (no key / loop failure).
- `lib/ai/modelRouter.ts`:
  - Rename `synthesizeWithDefaultModel` → kept as the legacy single-shot synthesizer used only by the deterministic fallback path.
  - Add a new `SYNTHESIS_SYSTEM_PROMPT_AGENTIC` constant for the agentic loop's `instructions`.
  - Keep existing `SYNTHESIS_SYSTEM_PROMPT` as `SYNTHESIS_SYSTEM_PROMPT_LEGACY`.
- `tests/unit/lib/ai/assistant.test.ts`:
  - Replace branch-routing tests with end-to-end tests against mocked `responses.create` that emit tool calls.
- `tests/unit/lib/ai/modelRouter.test.ts`:
  - Keep existing legacy-synthesizer tests (now testing only the deterministic-fallback path).

### 7.3 Removed files

None — `lib/ai/systemPrompt.ts` stays because `aiSystemPrompt` is still exported (now used by neither path but kept as a reference / for future use). If review prefers strict YAGNI, this file is deleted.

## 8. Testing strategy

### 8.1 Unit — pre-retrieval

- Reference regex: `"Romans 7"`, `"Rom 7:1-6"`, `"John 3:16"`, `"1 Cor 13"`, `"Romance languages"` (must NOT match), `"romance novels"` (must NOT match).
- Greek detection: `"What does νόμος mean?"` → `["νόμος"]`; `"compare λόγος and σάρξ"` → `["λόγος", "σάρξ"]`; `"What does law mean?"` → `[]`.
- Starter evidence: full prompt with both reference + Greek word should produce citations from both `getPassage` and `searchLemma`.

### 8.2 Unit — agentic loop

- **Happy path single tool call**: model emits one `searchLemma` call, loop executes it, model emits final answer in iteration 2. Assert citations, trace, output_text propagation.
- **Multi-tool single iteration**: model emits two parallel tool calls in one response. Both execute, both `function_call_output` items appended, model emits final answer.
- **Multi-iteration**: model calls tool A, sees result, calls tool B in next iteration, then answers.
- **Iteration cap**: model emits a tool call every iteration; loop hits `MAX_ITERATIONS`, returns null, caller falls back to deterministic.
- **Tool throws**: tool execution rejects; `function_call_output` is `{ error: "<msg>" }`; trace entry has `error`; loop continues.
- **Result truncation**: tool returns a 50KB result; serialized output sent back to the model is truncated to 8KB with a `…[truncated]` marker.

### 8.3 Unit — fallback paths

- `OPENAI_API_KEY` unset: pre-retrieval runs, no loop, answer built from starter evidence.
- Loop throws: pre-retrieval runs, loop fails, answer built from starter evidence + error trace entry.
- Empty starter evidence + no key: clean "no evidence found" answer in three-section template.

### 8.4 Integration

The existing `tests/integration/db-ownership.test.ts` is unaffected (auth/ownership scope unchanged). No new integration tests required for v1.

### 8.5 Acceptance

`scripts/acceptance-test.js` already exercises the assistant route. Update the assertion to expect at least one citation for a known good query (`"What is the meaning of νόμος in Romans 7?"`). This becomes the canary that the agentic path actually retrieves something.

### 8.6 Coverage gate

The existing thresholds (lines 80% / statements 80% / functions 75% / branches 65%) must continue to hold. New branches in `agenticLoop.ts` will need targeted tests; the iteration cap path and the tool-error path are the easiest branches to miss.

## 9. Rollback / feature gate

A single env var `TEXTLAB_ASSISTANT_DISABLE_AGENTIC=1` reverts to the legacy single-shot synthesizer (no tools, no pre-retrieval beyond what the legacy code did — effectively today's behavior minus the deleted branches, which means it's the "starter evidence only" deterministic fallback). This gives a fast rollback if the agentic loop misbehaves in production without redeploying.

Note: this env var does **not** restore the deleted dispatch table. The dispatch table is gone permanently after this change. The rollback is "agentic off → starter-evidence-only deterministic answer," not "rebuild the old branches."

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Model emits invalid arguments | `strict: true` on every tool. Argument-parse errors caught; `function_call_output` carries the error back. |
| Runaway tool-calling burns tokens/budget | `MAX_ITERATIONS = 5` hard cap. Loop returns null at cap. |
| Tool result floods the context | `MAX_TOOL_RESULT_CHARS = 8_000` truncation per call. `MAX_RESULTS_PER_TOOL_CALL = 20` paginates. |
| Latency regression | Worst case ~5 × per-call latency. Default `OPENAI_REQUEST_TIMEOUT_MS = 25_000` is per-call, not per-loop. Loop total has no hard cap — rely on iteration cap × per-call timeout. If real-world p95 is too slow, revisit. |
| Cost regression | Each iteration = one Responses API call. Worst case 5× current cost per request. Rate limit (10/min/user) already in place caps total exposure. |
| Model calls the wrong tool | Tool descriptions are written with explicit "use for X" guidance. Argument validation surfaces missteps. |
| Pre-retrieval double-fetches what the model would have called | Acceptable — the model sees starter evidence and is instructed not to re-fetch it. The synthesis prompt is explicit on this. |

## 11. Open questions

1. **Should `aiSystemPrompt` and `lib/ai/systemPrompt.ts` be deleted?** It's no longer imported by anything after this change. YAGNI says delete; reference-preservation says keep. Recommend delete; spec-review decision.
2. **Should we add a `getCrossReferences` tool?** Cross-reference lookup is a common Bible-study pattern but no current `lib/search.ts` function backs it. Out of scope for v1 per §3.1; flag for follow-up.
3. **Should `MAX_ITERATIONS` be env-tunable?** Probably not for v1 — easier to tune by code change after observing real traffic. Leave as a constant.

## 12. Estimated effort

- New files (`agenticLoop.ts`, `preRetrieval.ts`, `toolDefinitions.ts`): ~400 LOC
- Tests for those files: ~500 LOC
- Modified files (`assistant.ts`, `modelRouter.ts`): net deletion of ~200 LOC, addition of ~80 LOC
- Test updates: ~150 LOC of edits/additions

Total: ~1-2 days of focused work for an experienced TypeScript dev, plus 1 day for hardening based on acceptance-test behavior. Single PR, no migrations.
