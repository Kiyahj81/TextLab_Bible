# TextLab Bible — Project State

_Snapshot: 2026-05-22 (post Milestone 2.5 close-out)_

## Where the project stands

Milestone 2.5 — the **retrieval-first multi-model assistant foundation** — is shipped to `main`. Two PRs merged in sequence (#1 milestone + #2 vitest 4 audit follow-up). The branch is in a clean, verified state across all five milestone gates (lint, tsc, build, test:unit, test:acceptance).

## What's on main

### Runtime surfaces

| Route | Purpose |
|---|---|
| `/read` | Passage reader; clickable Greek tokens with morphology popover; highlight + note save |
| `/search` | Three modes: lemma, keyword, morphology — with pagination + saved-search persistence |
| `/assistant` | AI Study Assistant — retrieval-first with live/fallback mode indicator |
| `/notes` | Notes index (verse notes + assistant-generated notes) |
| `/api/assistant` | POST endpoint: dispatches local retrieval, optionally synthesizes via OpenAI Responses API |
| `/api/notes`, `/api/saved-searches`, `/api/highlights`, `/api/import-runs`, `/api/generated-study-notes` | CRUD endpoints |

### Assistant pipeline

The assistant route follows a clear retrieval-first contract:

1. **Route the prompt** (`routeAssistantPrompt`) — returns `{ modelRole, modelUsed, routingDecision }` and an optional advisory `recommendedUpgrade` if scholarly cues are detected.
2. **Run local retrieval first** (`answerFromLocalRetrieval`) — a **dispatch table** of branch functions (`importantWordsBranch`, `lemmaAliasBranch`, `morphologyBranch`, `passageBranch`, `keywordFallback`) iterates until one returns an answer. Branches share a `BranchContext` with the prompt, normalized lowercased prompt, detected book, routing, and an accumulating `ToolTraceEntry[]`.
3. **Optionally synthesize** (`synthesizeWithDefaultModel`) — when `OPENAI_API_KEY` is set, calls the official `openai@4` SDK's `responses.create` with the local answer + citations (capped at 20 entries) + structured tool trace as context. Throws are caught and the deterministic local answer is returned with `mode: "fallback"`.
4. **Persist the exchange** — `startAssistantExchange` initiates the user-message DB write before `answerBibleQuestion` runs (parallelizing the user write with synthesis); `finishAssistantExchange` writes the assistant message with typed `AssistantMessageMetadata` JSON.

### Test surfaces

- **15 unit tests across 7 files** (vitest 4 + jsdom + RTL):
  - `tests/unit/sanity.test.ts`
  - `tests/unit/lib/search.test.ts` — bulk verse hydration
  - `tests/unit/lib/search-findLemmaExamples.test.ts` — bounded findMany
  - `tests/unit/lib/ai/assistant.test.ts` — important-words branch (3 tests covering retrieval shape + book detection)
  - `tests/unit/lib/ai/modelRouter.test.ts` — SDK adoption (7 tests covering constructor args, missing key, default timeout, invalid timeout, citations cap, empty output, fallback on rejection)
  - `tests/unit/api/assistant.test.ts` — session persistence + user-write overlap
  - `tests/unit/components/ReaderControls.test.tsx` — derived chapter from book + passages
- **Playwright acceptance suite** (`scripts/acceptance-test.js`) — 10 end-to-end interactions covering the golden path

### Database

- Prisma 6 over PostgreSQL on `localhost:5433`
- Now using proper migrations (3 on disk):
  - `0_init` — baseline reflecting pre-rename schema
  - `20260521162527_assistant_message_metadata` — `AiMessage.citations → metadata`
  - `20260522193249_token_lemma_index` — composite `(corpusId, bookId, partOfSpeech, lemma)` for `getTopLemmas`

### Tech stack

- Next 15.5 / React 19 / TypeScript 5.8
- OpenAI Node SDK v4 (shared client in `lib/ai/openaiClient.ts`, env-driven timeout, `maxRetries: 1`)
- Vitest 4 / Vite 6 / oxc JSX transform
- @testing-library/react 16 + jsdom 29

## Known outstanding items

### Security: 2 moderate dev-tooling vulnerabilities (upstream-blocked)

Both are the same advisory: **postcss <8.5.10** (GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS stringify), bundled inside Next 15.3. Even `next@latest` (16.x) still ships postcss 8.4.31. **No action available** until Next bumps its bundled postcss. Re-run `npm audit` after each Next release.

### Deferred from the 2026-05-21 code review

- **L14: Always-on local retrieval** — flagged-only; no behavior change required at this severity. Revisit if synthesis cost or latency becomes a concern.
- **L17: URL-driven reader navigation** — explicitly deferred to Step 4 (Reader Navigation milestone).
- **L18: Per-row AiMessage metadata size** — flagged-only. Today the metadata JSON includes the full citations array and tool trace per assistant message. If this grows pathologically, prune to citation refs only and rehydrate on demand.

### Documentation gaps

- `README.md` still describes Milestone 2; doesn't reflect the assistant pipeline, mode indicator, or new test commands.
- No developer onboarding doc for the dispatch table — a new contributor adding a sixth branch has to read the existing four to learn the pattern.

## Logical next steps

Listed in roughly the order they make sense to tackle, with rough effort sizing.

### 1. Step 3: Scholarly Mode V1 (M-sized milestone, the natural next vertical slice)

The current code already returns `recommendedUpgrade` advisory metadata when scholarly cues are detected, but never escalates. Step 3 turns that recommendation into a real user-confirmed escalation path.

Concretely:
- **UI**: when `recommendedUpgrade` is present on the assistant response, render a "Use scholarly model" affordance that re-submits the same prompt with an escalation flag.
- **API**: `POST /api/assistant` accepts an optional `escalate: true` field. When set, the route invokes `gpt-5.4` (currently `OPENAI_SCHOLARLY_MODEL`) for synthesis — but only after the same local retrieval has run.
- **Persistence**: `AiMessage.metadata` already has the typed `modelRole` field. No schema change needed; just emit `"scholarly"` on the assistant message when it was generated by the scholarly model.
- **Tests**: a mocked test that escalation actually calls the scholarly model exactly once; a test that `escalate: true` without `recommendedUpgrade` is rejected (or auto-runs anyway — design choice).
- **Guardrail check**: the original milestone plan says "Never call gpt-5.4 automatically." Step 3 preserves that — escalation is always user-initiated.

This builds directly on the dispatch-table shape and the shared OpenAI client. Estimated 3-5 small commits.

### 2. Step 4: Reader Navigation (M-sized)

Closes the L17 deferred item plus adds the UX polish the milestone plan calls out:
- Prev/next chapter controls (today the dropdown is the only navigation).
- Reference jump by book + chapter + verse (URL-driven, `/read?book=John&chapter=3&verse=16`).
- Verse range support in the URL and in the rendered passage.
- Mobile wrapping check at full-chapter length (today's seed data is short; a 50-verse chapter is the real stress test).

This is mostly frontend work. The `ReaderControls` derived-state refactor (Task 12) already sets up the right state shape — adding URL sync is a `useSearchParams` / `useRouter` integration.

### 3. Test coverage gaps (S-sized, can be done in parallel)

Three concrete gaps worth closing:
- **`searchKeyword` and `searchMorphology` unit tests** — currently only `searchLemma` and `findLemmaExamples` have direct unit coverage. The shape is similar; mostly copy-and-adapt.
- **Empty-retrieval safe response** — the milestone plan calls for "empty retrieval produces a safe no-evidence response" but no unit test exists for the path where every search returns zero results.
- **Scholarly-recommendation routing test** — the milestone plan calls for "Scholarly prompts can return `recommendedUpgrade`, but no Milestone 2.5 path calls gpt-5.4." Worth a direct test that asserts the upgrade is advisory-only today (and won't be regressed when Step 3 lands).

### 4. README + dev onboarding refresh (S-sized)

The current README still anchors to Milestone 2. Worth updating to reflect:
- The assistant pipeline (`mode: "live" | "fallback"`, structured citations, `formatToolTrace` rendering)
- The new test commands (`npm run test:unit`, `npm run test:acceptance`)
- The `.env` setup (system env vars override `.env` per Next.js precedence)
- The dispatch-table extension pattern (how to add a new branch)
- The migrations folder convention (after Task 4 of the code review, we use proper Prisma migrations)

### 5. Step 5: Import parser tests (S-sized backlog)

The milestone plan calls for:
- WEB USFM cleaning tests (footnotes, cross-references, `\w` / `\+w` / Strong's residue)
- MorphGNT morphology normalization tests
- Importer failure paths (missing WEB dir, failed MorphGNT fetch, partial rollback)

These are pure unit tests against `scripts/import-open-bible.ts`. Sound investment before any future corpus expansion.

### 6. Step 6: Notes workflow polish (M-sized)

Once Step 3 (Scholarly Mode) and Step 4 (Reader Nav) land, the notes flow becomes the next-most-friction surface:
- Link generated study notes to the structured citations they were built from (today the link is implicit via prompt text).
- Filter notes by reference / tag / note type.
- Edit flow from assistant answer → saved note (today it's an export-or-discard binary).

### 7. Step 7: Corpus and import visibility (S-sized)

An admin/settings page that surfaces: which corpora are imported, verse/token counts per corpus, last import time. Useful for local development and for catching incomplete imports.

### 8. Production-readiness work (L-sized, deferred milestone)

Today the app uses a hardcoded `localUserId` (`lib/user.ts`). All notes, highlights, saved searches, and assistant sessions are scoped to that single user. Multi-user support means:
- Auth integration (NextAuth.js or similar)
- Migration to add `userId` to all user-scoped tables (already there in most cases — just need real values)
- Authorization checks in every API route
- Session management across reader and assistant

Worth treating as its own milestone, not folded into 2.5 follow-up work.

## Decision points

A few open questions that aren't blockers but will need a call before the next vertical slice:

1. **Where does L18 (per-row metadata size) need to land?** As long as assistant sessions stay short, the current shape is fine. If you start using the assistant heavily, watch the size of `AiMessage.metadata` rows. Pruning citations from the persisted metadata (keep only refs, rehydrate on read) is a small refactor — but only worth doing if rows actually grow.
2. **Does Step 3 introduce streaming?** The milestone plan explicitly says no streaming in Step 2. Step 3 could go either way. Streaming would be a meaningful UX upgrade for scholarly answers (which take longer), but it would expand the API contract.
3. **Will the bundle-time postcss advisory actually get fixed upstream?** If Next 16.0 stable lands with patched postcss, we get the fix for free. If 16.x lingers on 8.4.31, the project may need to swap postcss-loader manually. Not urgent — flag for the next dep-bump cycle.

## Quick reference

### Verify a clean state

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run lint
npx tsc --noEmit
npm run build
npm run test:unit
npm run test:acceptance
```

All five should exit 0.

### Start the dev server

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run dev
```

App at http://localhost:3000. With `OPENAI_API_KEY` set (system env or `.env`), assistant runs in live mode; without it, deterministic local-retrieval fallback.

### Re-audit dependencies

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm audit
```

Expected residual until Next bumps bundled postcss: 2 moderate (GHSA-qx2v-qp2m-jg93).
