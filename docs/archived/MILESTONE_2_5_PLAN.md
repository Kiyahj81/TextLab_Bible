# Milestone 2.5 Plan

Milestone 2 is complete: the app can work against the full imported New Testament corpus using SBLGNT/MorphGNT for Greek and WEB for English. Milestone 2.5 should stabilize that corpus-backed experience and replace the current deterministic assistant behavior with a real retrieval-first assistant while preserving a safe local fallback.

## Status

- [x] Step 1: Update the MVP spec to match the WEB decision.
  - WEB is the MVP English corpus.
  - NET is deferred unless licensing and distribution requirements are resolved later.
- [ ] Step 2: Harden the assistant with live model support, local retrieval tools, citation structure, and persisted Q&A history.

## Current Baseline

- SBLGNT/MorphGNT is imported for the Greek New Testament.
- WEB is imported for the English New Testament.
- The app has corpus-backed reader, keyword search, morphology lookup, generated notes, and deterministic assistant behavior.
- Milestone 2 verification passed with lint, TypeScript, production build, and acceptance tests.
- Zip archives and extracted import data remain local-only and ignored by Git.

## Step 2 Plan: Retrieval-First Multi-Model Assistant Foundation

### Product Behavior

- Keep the assistant retrieval-first: it should answer from local Bible data, morphology data, notes, and saved searches rather than making unsupported claims.
- Enable live OpenAI responses when `OPENAI_API_KEY` is present.
- Preserve deterministic local fallback behavior when no API key is configured or when the model call fails safely.
- Do not add streaming in this step.
- Show whether a response came from live assistant mode or local fallback mode.
- Keep generated notes explicit: assistant Q&A history is saved automatically, but converting an answer into a user note remains a deliberate action.
- Prepare for a multi-model architecture without making automatic scholarly-model calls in Milestone 2.5.

### Model And Configuration

- Add `OPENAI_API_KEY` to `.env.example`.
- Add `OPENAI_DEFAULT_MODEL` with a default of `gpt-5.3-chat-latest`.
- Add `OPENAI_SCHOLARLY_MODEL` with a default of `gpt-5.4`.
- Use `gpt-5.3-chat-latest` for normal chat, tool orchestration, search planning, retrieval sequencing, citation assembly, table generation, study note drafting, UI interactions, and light synthesis.
- Treat `gpt-5.4` as the future scholarly reasoning engine for deeper synthesis, complex theological nuance, cross-text reasoning, ambiguity handling, long-content analysis, and research-quality outputs.
- In Milestone 2.5, only the default model is called. Scholarly mode is advisory metadata only.
- Keep model selection environment-driven so stronger or replacement models can be used without code changes.
- Use the OpenAI Responses API for synthesis over locally executed retrieval context.

### Local Tooling

Create a small assistant tool registry over existing app capabilities:

- `get_passage`
  - Input: book, chapter, optional verse or verse range, corpus preference.
  - Output: normalized passage text with verse references and corpus metadata.
- `search_bible`
  - Input: query, corpus filter, optional book/chapter scope, limit.
  - Output: ranked verse hits with references and snippets.
- `get_morphology`
  - Input: token id or Greek form/lemma plus optional reference.
  - Output: token, lemma, part of speech, morphology code, gloss, and reference.
- `list_notes`
  - Input: optional reference, tag, or note type filter.
  - Output: saved notes relevant to the prompt.

The live model may call these tools, but the app should execute all retrieval locally. Do not expose arbitrary database access or network lookup as assistant tools.

### API Contract

Keep the existing `/api/assistant` response shape compatible, then extend it:

- Preserve:
  - `answer`
  - `markdown`
  - `citations`
  - `toolTrace`
- Add:
  - `mode`: `live` or `fallback`
  - `sessionId`
  - `modelRole`: `default` in Milestone 2.5
  - `modelUsed`
  - `routingDecision`
  - optional `recommendedUpgrade` for future scholarly mode
  - structured citation fields such as `toolName`, `book`, `chapter`, `verse`, `corpus`, `searchQuery`, and optional `tokenId`

The UI should continue rendering current citations while being ready to show richer citation metadata as the assistant improves.

### Persistence

- Persist every assistant exchange in the existing assistant/session data model.
- Store user prompt, assistant answer, mode, citations, and tool trace.
- Reuse or extend `AiSession` and `AiMessage` rather than introducing a separate chat store unless the current schema blocks the feature.
- Keep generated study notes as separate saved notes, linked to citations where useful.

### Guardrails

- If retrieval returns no relevant evidence, say so plainly and avoid inventing details.
- If a user asks for content outside the imported corpus or local notes, explain the current corpus boundary.
- Retry a failed live model call once only when the failure is transient.
- Fall back locally when the API key is missing, the configured model is unavailable, or the live call fails after retry.
- Never call `gpt-5.4` automatically in Milestone 2.5.
- If a prompt appears to need scholarly reasoning, return advisory upgrade metadata only.
- Keep tool traces concise and user-visible enough for debugging without exposing secrets or raw environment values.

### Tests And Verification

Add focused tests around assistant behavior:

- No-key fallback returns a deterministic answer and `mode: "fallback"`.
- Mocked live assistant can call local retrieval tools and returns `mode: "live"`.
- Live/default routing returns `modelRole`, `modelUsed`, and `routingDecision`.
- Scholarly prompts can return `recommendedUpgrade`, but no Milestone 2.5 path calls `gpt-5.4`.
- Structured citations survive API serialization and UI rendering.
- Empty retrieval produces a safe no-evidence response.
- Assistant exchanges persist to `AiSession` and `AiMessage`.
- Existing generated-note save flow still works.
- Acceptance test covers a Greek lemma search such as `logos`, a morphology lookup, and saving a generated note.

Run this sequence before considering Step 2 complete:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run test:acceptance
```

## Next Steps After Step 2

### Step 3: Scholarly Mode V1

- Add UI support for hybrid escalation: the app recommends deeper scholarly mode, then asks the user to confirm before using `gpt-5.4`.
- Use `gpt-5.4` only after local retrieval has already gathered the relevant biblical text, morphology, notes, and search results.
- Persist both default-model routing metadata and scholarly-model response metadata.

### Step 4: Reader Navigation

- Add previous/next chapter controls.
- Add reference jump by book, chapter, and verse.
- Support verse ranges in the reader.
- Keep selected token or selected verse reflected in the URL when practical.
- Check mobile wrapping and long chapter performance against the full corpus.

### Step 5: Import Parser Tests

- Add tests for WEB USFM cleaning, including footnotes, cross references, `\w`, `\+w`, and Strong's-style residue.
- Add tests for MorphGNT morphology normalization.
- Add importer failure tests for missing WEB directory, failed MorphGNT fetch, and partial import rollback expectations.

### Step 6: Notes Workflow

- Link generated notes to structured citations.
- Add filters by reference, note type, and tag.
- Improve the flow from assistant answer to editable saved note.

### Step 7: Corpus And Import Visibility

- Add an admin or settings view showing imported corpora, verse counts, token counts, and latest import time.
- Show WEB/SBLGNT status in a way that makes local corpus state obvious during development.

### Step 8: Milestone 3 Decision Point

- Choose the next vertical slice only after Milestone 2.5 passes verification.
- Defer Hebrew Bible, LXX, richer lexicons, and manuscript features until the New Testament retrieval assistant is stable.

## Constraints

- Keep the architecture simple inside the current Next.js app.
- Prefer vertical slices over broad refactors.
- Do not commit imported corpus data, source zip files, or local environment secrets.
- Do not reintroduce NET as the default English corpus for the MVP.
- Do not add external scholarly claims unless the supporting source is part of an approved local corpus or future licensed dataset.

## References

- OpenAI model docs: https://developers.openai.com/api/docs/models
- OpenAI model comparison docs: https://developers.openai.com/api/docs/models/compare
