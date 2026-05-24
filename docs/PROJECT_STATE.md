# TextLab Bible — Project State

_Snapshot: 2026-05-24 (post UI Review remediation, PR 1–16)_

## Where the project stands

Milestone 2.5 (retrieval-first multi-model assistant foundation) is on `main`. On top of that, a three-pass UI review documented **55 findings** which were addressed across PRs 1–11; PRs 12–16 then added follow-up features and UX refinements based on hands-on testing. Sixteen PRs total are on `main`, pushed to `origin/main` on 2026-05-24. All five milestone gates are green (lint, tsc, build, test:unit 84/84, test:acceptance).

### UI review remediation (PRs 1–11) — closed

- **Pass 1: Functional bugs** — 15 findings (4 critical, 6 moderate, 5 minor) — 100% closed
- **Pass 2: Layout & sizing** — 12 findings (1 critical, 6 moderate, 5 minor) — 100% closed
- **Pass 3: UX & design quality** — 28 findings (2 critical, 15 moderate, 11 minor) — 100% closed, including a 12-finding design-identity epic (PR 10/11) that adopted an editorial-scholar aesthetic — Spectral display serif + Inter Tight UI sans + Gentium Plus for polytonic Greek, a derived accent palette from `#365f7e`, codex left-rule pattern, paper-grain background.

Review docs at `docs/ui-review/pass-{1,2,3}-*.md`. Every finding carries a `✅ Fixed in PR<N>` annotation.

### Post-review feature work (PRs 12–16)

Surfaced through use after the formal review closed:

- **PR 12** — Reader: bottom ChapterNav, `ReaderLocationMemo` restores last-visited passage from localStorage, `HighlightMenu` "Clear" swatch + DELETE endpoint, cross-instance color sync via custom DOM event.
- **PR 13** — Search: match highlighting on result verses (keyword query / lemma surface), in-input Search + Clear buttons replacing the external submit.
- **PR 14** — Reader: **per-word English highlighting** with per-word color popover, mirroring the Greek-token UX. Schema gained `Highlight.englishWordIndex Int?` (4th Prisma migration); `HighlightPalette` extracted from `HighlightMenu` for reuse by `EnglishWordPopover`.
- **PR 15** — Removed vestigial verse-level "Highlight verse" button after PR 14 made highlighting fully per-word.
- **PR 16** — Reader: `ReaderControls` resyncs dropdowns to URL after location restore. Notes: tag filter is now a select (`All tags` / `verse` / `word`), new keyword search input on the filter row, where-clause refactored to AND-of-conditions so keyword + reference + tag compose cleanly.

## What's on main

### Runtime surfaces

| Route | Purpose |
|---|---|
| `/read` | Passage reader; clickable Greek tokens with morphology popover; **per-word English highlighting** with color palette popover; verse-jump input, prev/next chapter (top + bottom), Greek/English/Parallel mode toggle, last-passage restore |
| `/search` | Three modes (lemma / keyword / morphology) with **match highlighting** on result verses, in-input Search + Clear, pagination, saved-search persistence |
| `/assistant` | AI Study Assistant — retrieval-first with live/fallback mode indicator, codex-gutter sidebar (trace + citations + generated notes) |
| `/notes` | Notes index with **keyword search**, tag dropdown filter, reference filter, sort (Most recent / Canonical / Title), server-side pagination |
| `/api/assistant` | POST endpoint: dispatches local retrieval, optionally synthesizes via OpenAI Responses API |
| `/api/notes`, `/api/saved-searches`, `/api/saved-searches/[id]`, `/api/highlights` (POST + DELETE), `/api/import-runs`, `/api/generated-study-notes` | CRUD endpoints |

### Assistant pipeline

The assistant route follows a clear retrieval-first contract:

1. **Route the prompt** (`routeAssistantPrompt`) — returns `{ modelRole, modelUsed, routingDecision }` and an optional advisory `recommendedUpgrade` if scholarly cues are detected.
2. **Run local retrieval first** (`answerFromLocalRetrieval`) — a **dispatch table** of branch functions (`importantWordsBranch`, `lemmaAliasBranch`, `morphologyBranch`, `passageBranch`, `keywordFallback`) iterates until one returns an answer. Branches share a `BranchContext` with the prompt, normalized lowercased prompt, detected book, routing, and an accumulating `ToolTraceEntry[]`.
3. **Optionally synthesize** (`synthesizeWithDefaultModel`) — when `OPENAI_API_KEY` is set, calls the official `openai@4` SDK's `responses.create` with the local answer + citations (capped at 20 entries) + structured tool trace as context. Throws are caught and the deterministic local answer is returned with `mode: "fallback"`.
4. **Persist the exchange** — `startAssistantExchange` initiates the user-message DB write before `answerBibleQuestion` runs (parallelizing the user write with synthesis); `finishAssistantExchange` writes the assistant message with typed `AssistantMessageMetadata` JSON.

### Test surfaces

- **84 unit tests across 17 files** (vitest 4 + jsdom + RTL). Notable additions since the M2.5 snapshot:
  - `tests/unit/api/highlights.test.ts` — POST/DELETE shape, `englishWordIndex` requires `verseId`, slot-replace semantics
  - `tests/unit/api/notes.test.ts`, `tests/unit/api/saved-searches.test.ts`, `tests/unit/api/saved-searches-id.test.ts` — CRUD shape + 404/400 paths
  - `tests/unit/lib/highlight.test.ts` — color palette + storage round-trip
  - `tests/unit/lib/notes-filter.test.ts` — `parseReferenceFilter` + `parseNotesSort`
  - `tests/unit/lib/search-getPassageNeighbors.test.ts` — prev/next chapter computation
  - `tests/unit/lib/search-highlight.test.ts` — match splitter (case-insensitive, Unicode NFC, regex-metachar escape, polytonic Greek)
  - `tests/unit/lib/useAutoDismissStatus.test.ts` — status-auto-dismiss hook
- **Playwright acceptance suite** (`scripts/acceptance-test.js`) — 10 end-to-end interactions covering the golden path; updated for the renamed Assistant h1 and the in-input Search button.

### Database

- Prisma 6 over PostgreSQL on `localhost:5433`
- 4 migrations on disk:
  - `0_init` — baseline reflecting pre-rename schema
  - `20260521162527_assistant_message_metadata` — `AiMessage.citations → metadata`
  - `20260522193249_token_lemma_index` — composite `(corpusId, bookId, partOfSpeech, lemma)` for `getTopLemmas`
  - `20260524083541_add_english_word_index_to_highlight` — `Highlight.englishWordIndex Int?` + index on `(userId, verseId, englishWordIndex)` to support per-word English highlights (PR 14)

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
- **L17: URL-driven reader navigation** — ✅ closed by PR 2 (prev/next chapter), PR 5 (`?verse=N` anchor), PR 11 (verse-number input), PR 12 (`ReaderLocationMemo` last-passage restore + bottom ChapterNav), PR 16 (`ReaderControls` URL resync).
- **L18: Per-row AiMessage metadata size** — flagged-only. Today the metadata JSON includes the full citations array and tool trace per assistant message. If this grows pathologically, prune to citation refs only and rehydrate on demand.

### Documentation gaps

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

### 2. Step 4: Reader Navigation (M-sized) — ✅ substantially complete

Closed across the UI review remediation:
- ✅ Prev/next chapter controls (top and bottom) — PR 2 + PR 12
- ✅ Reference jump via verse-number input — PR 11
- ✅ `?verse=N` URL anchor + scroll-into-view — PR 5
- ✅ Last-visited passage restored on bare `/read` — PR 12
- ⏭️ Verse range support in the URL and rendered passage — still deferred
- ⏭️ Mobile wrapping check at full-chapter length — covered by acceptance test for John 1 (51 verses) but not stress-tested at scale

### 3. Test coverage gaps (S-sized, can be done in parallel)

Three concrete gaps worth closing:
- **`searchKeyword` and `searchMorphology` unit tests** — currently only `searchLemma` and `findLemmaExamples` have direct unit coverage. The shape is similar; mostly copy-and-adapt.
- **Empty-retrieval safe response** — the milestone plan calls for "empty retrieval produces a safe no-evidence response" but no unit test exists for the path where every search returns zero results.
- **Scholarly-recommendation routing test** — the milestone plan calls for "Scholarly prompts can return `recommendedUpgrade`, but no Milestone 2.5 path calls gpt-5.4." Worth a direct test that asserts the upgrade is advisory-only today (and won't be regressed when Step 3 lands).

### 4. Dev onboarding doc (S-sized)

The README is current as of PR 16. Still worth a short dev-facing doc for:
- The dispatch-table extension pattern (how to add a new retrieval branch).
- The `HighlightPalette` component pattern (used by both `HighlightMenu` and `EnglishWordPopover`).
- The migrations folder convention (proper Prisma migrations since the M2.5 code review).
- Custom DOM events for cross-instance state (`textlab:highlight-color-change`).

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
