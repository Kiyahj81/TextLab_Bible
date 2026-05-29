# TextLab Bible — Project State

*Snapshot: 2026-05-29 (post Milestone 3 Phase 2 — Grounding + Silence Protocol)*

## Where the project stands

Milestone 2.5 (retrieval-first multi-model assistant foundation) is on `main`. On top of that, a three-pass UI review documented **55 findings** which were addressed across PRs 1–11; PRs 12–16 then added follow-up features and UX refinements based on hands-on testing. After PR 16, a single follow-up commit (`d754ffe`) closed three import-accuracy bugs surfaced during hands-on reading. Most recently, a four-sprint **Phase 3.0 security and testing remediation** landed real authentication, request hardening, browser-security headers, and a coverage gate — see [Phase 3.0 remediation](#phase-30-security-and-testing-remediation-sprints-14) below. All gates green: `npm run verify` (lint + tsc + build + coverage) and `npm run test:acceptance` exit 0.

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

### Post-Phase-3.0 bug fixes

#### Synthesis prompt bug (2026-05-27)

`lib/ai/modelRouter.ts` `ASSISTANT_INSTRUCTIONS` previously included `aiSystemPrompt` verbatim, which contains the directive *"first call the relevant search or passage tool."* But `synthesizeWithDefaultModel` calls the Responses API with no `tools:` array registered — so the model, receiving an instruction to call tools but no tools to call, wrote tool-call invocations as prose output instead of a real answer. The fix replaces the shared `aiSystemPrompt` in the synthesis context with a purpose-built `SYNTHESIS_SYSTEM_PROMPT` that makes the synthesizer role explicit: retrieval is already done, do not call tools, improve the provided draft. A new test in `tests/unit/lib/ai/modelRouter.test.ts` locks this down. Also fixed: `.claude/**` was not in the ESLint `ignores` list, causing stale worktree build artifacts to be linted.

### Post-PR 16 import accuracy fixes

Single commit `d754ffe` ("Fix WEB/SBL import accuracy for multi-line verses, marker spacing, and Pericope Adulterae") addressing three import-pipeline bugs the user surfaced while reading:

1. `**parseUsfm` dropped continuation lines.** USFM verses whose text continues past a mid-verse `\p`/`\q`*/`\m`/`\nb` marker (Rom 16:20's grace doxology, Pauline benedictions, Psalms/prophets poetry blocks) lost everything after the first source line. Now accumulates chunks until the next `\v`, `\c`, `\id`, or EOF.
2. `**cleanUsfmText` collapsed whitespace across consecutive markers.** Each stripped marker also consumed one trailing whitespace, so sequences like `write:\wj* \p \wj "He` (Rev letters to the seven churches) rendered as `write:"He` with no separator. Fix: replace stripped markers with `" "` instead of `""`; the existing whitespace-collapse cleans up doubles.
3. **Pericope Adulterae (John 7:53–8:11) missing from SBL.** MorphGNT omits PA per SBLGNT bracketed-text convention, and `getReaderPassage` anchors on Greek verses. MACULA has PA tokens but the importer only updated glosses on existing rows. Now inserts missing tokens and builds verse text via the existing `joinGreekVerse` helper.
4. **MACULA PA punctuation overrides.** MACULA's PA data has 29 missing/wrong clause-final stops and one `;;` text-corruption artifact (8:10!14). A `MACULA_OVERRIDES` table in `scripts/import-open-bible.ts` patches each position against Holmes 2010 SBL GNT before parsing; verses listed in the override table are force-refreshed every import so changes land on tokens that already exist in the DB. If Clear-Bible publishes a curated PA upstream, drop the matching entries.

Adds 14 unit tests covering both parsers (9 `parseUsfm` cases including the Rom 16:20 / Rev 2:1 / Acts 15:23 / John 7:53→`\c 8`→8:1 shapes; 5 `parseMaculaTsv` override cases).

### Phase 3.0 security and testing remediation (Sprints 1–4)

A four-sprint hardening effort, executed against `docs/archived/security-testing-remediation-plan.md`, took the app from "single hardcoded local user, no validation gate, no security headers" to "real auth, validated mutations, browser-hardening headers, and a coverage gate."

- **Sprint 1 (`e126f44`) — Stop the bleeding.** Assistant prompt cap (2,000 chars) + output-token cap (`OPENAI_MAX_OUTPUT_TOKENS`) + in-memory token-bucket rate limiter (10/min, 429 with `Retry-After`, serverless-aware no-op). Server-side highlight color allowlist. Shared `readJsonLimited` (16 KB default) + `validateBody` (zod) + `jsonError` request helpers. Stub `requireAuth()` so Sprint 2 could swap the implementation without rewriting handlers.
- **Sprint 2 (`436036d`) — Authentication and authorization.** Auth.js v5 with the Prisma adapter, GitHub OAuth provider, and a dev-only Credentials provider gated on `AUTH_DEV_ENABLED=1`. New `User` / `Account` / `Session` / `VerificationToken` models with FK chains to existing user-owned tables. `lib/auth.ts` exports `requireAuth` (401), `requirePageAuth` (redirect), `getOptionalUserId`. Every API route and protected page now enforces ownership. `getReaderPassage(book, chapter, userId)` scopes the included `notes`/`highlights` so reader data cannot leak across users.
- **Sprint 3 (`5775bae`) — HTTP and deployment hardening.** `lib/http/security.ts` adds `assertSameOrigin(request)` wired into every POST/PATCH/DELETE — 403 on cross-origin writes, allow-through for non-browser clients (no Origin). `next.config.ts` headers block: CSP (no `api.openai.com`, no prod `unsafe-eval`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/microphone/geolocation/payment/usb/interest-cohort), HSTS prod-only. Explicit Auth.js cookie config (httpOnly, sameSite=lax, secure in prod). `docs/security-register.md` documents the upstream-blocked PostCSS advisory.
- **Sprint 4 (`08b9639`, `ec037e6`, `c181b97`) — Test coverage and CI gates.** Route tests for `generated-study-notes` and `import-runs`. Validation-depth tests (length caps, negative `englishWordIndex`). Assistant XSS-rendering safety test. `next.config.ts` headers config test. PostgreSQL preflight in `scripts/acceptance-test.js`. **Real JWT session revocation** via `User.sessionsValidFrom` watermark — bumped on every signOut, checked in the session callback, so a replayed cookie captured before signout now returns 401 (verified end-to-end with curl). Acceptance test signs in via dev credentials before exercising protected pages. **DB integration suite** (`tests/integration/db-ownership.test.ts`) running real Prisma — per-user scoping for notes/highlights/saved-searches/generated-notes/ai-sessions + `onDelete: Cascade` FK behavior. **Coverage gate** via v8 over `app/api/`** + `lib/**`: lines 84.73% / statements 81.53% / functions 77.48% / branches 66.53% — all above thresholds (80/80/75/65).

Two latent client bugs surfaced during the acceptance-test wiring: `SearchPanel` was sending `chapter: ""` and `AiAssistant` was sending `sessionId: null` — both rejected by the Sprint 1 Zod schemas. Both now omit the empty field instead. A follow-up commit added the custom `/signin` page and a global header sign-out, completing the user-facing surface over the auth + revocation backend that Sprints 2 and 4 stood up.

## What's on main

### Runtime surfaces

| Route | Purpose |
|---|---|
| `/read` | Passage reader; clickable Greek tokens with morphology popover; **per-word English highlighting** with color palette popover; verse-jump input, prev/next chapter (top + bottom), Greek/English/Parallel mode toggle, last-passage restore |
| `/search` | Three modes (lemma / keyword / morphology) with **match highlighting** on result verses, in-input Search + Clear, pagination, saved-search persistence |
| `/assistant` | AI Study Assistant — retrieval-first with live/fallback mode indicator, codex-gutter sidebar (trace + citations + generated notes) |
| `/notes` | Notes index with **keyword search**, tag dropdown filter, reference filter, sort (Most recent / Canonical / Title), server-side pagination |
| `/api/assistant` | POST endpoint: auth-gated, prompt cap, rate-limited (10/min, `Retry-After`); dispatches local retrieval and optionally synthesizes via OpenAI Responses API |
| `/api/notes`, `/api/saved-searches`, `/api/saved-searches/[id]`, `/api/highlights` (POST + DELETE), `/api/import-runs`, `/api/generated-study-notes` | CRUD endpoints — all auth-gated (401), validated (zod), same-origin (403 cross-origin), 16 KB body cap |
| `/signin` | Custom sign-in page; styled card matching the editorial-scholar palette. Renders the dev-credentials form (when `AUTH_DEV_ENABLED=1`) and a GitHub OAuth button (when `GITHUB_CLIENT_ID/SECRET` are set). Redirects authenticated visitors back to `/read`. Surfaces inline errors from server-action validation and Auth.js `?error=` redirects. |
| `/api/auth/[...nextauth]` | Auth.js v5 catch-all — provider callbacks (GitHub OAuth in prod, dev Credentials behind `AUTH_DEV_ENABLED=1`), session, signout. User-facing sign-in lives at `/signin`. |

### Assistant pipeline

The assistant route follows a clear retrieval-first contract:

1. **Route the prompt** (`routeAssistantPrompt`) — returns `{ modelRole, modelUsed, routingDecision }` and an optional advisory `recommendedUpgrade` if scholarly cues are detected.
2. **Run local retrieval first** (`extractSignals` → `runRetrievalPlan`) — the Paradigm C deterministic-first pipeline (`lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`): signals are extracted from the prompt, `buildPlan` turns them into a bounded set of DB-backed calls (passage/lemma/keyword/morphology/top-lemmas), and `runRetrievalPlan` executes them into an `EvidencePacket` (citations, tool trace, formatted evidence).
3. **Optionally synthesize** (`synthesizeWithRefinement`) — when `OPENAI_API_KEY` is set, calls the official `openai@4` SDK's `responses.create` with the local answer + citations (capped at 20 entries) + structured tool trace as context. The model returns structured JSON (`answer` + `claims[]`) via a strict json\_schema output format. Throws are caught and the deterministic local answer is returned with `mode: "fallback"`.
4. **Verify grounding** (`verifyGrounding` in `lib/ai/grounding.ts`) — each claim's cited reference is resolved and the quoted text is fuzzy-matched against the real DB verse. SBLGNT is the citation authority: a Greek-quote score below 0.90 or an unresolvable reference fails the claim and `answerBibleQuestion` returns a structured refusal (`grounded: false`) instead of the draft — the withheld answer is what gets stored, never the draft. WEB is a non-authoritative display aid: a WEB mismatch or missing verse appends an alignment caveat but does not refuse. The `grounded` boolean and optional `groundingReport` are recorded in `AssistantMessageMetadata`; `AiAssistant` renders a "Withheld — insufficient evidence" banner when `grounded === false`. Deterministic fallback paths are grounded-by-construction; a verification infra-throw falls back deterministically.
5. **Persist the exchange** — `startAssistantExchange` initiates the user-message DB write before `answerBibleQuestion` runs (parallelizing the user write with synthesis); `finishAssistantExchange` writes the assistant message with typed `AssistantMessageMetadata` JSON (including `grounded` + `groundingReport`).

### Test surfaces

- **322 unit tests across 40 files** (vitest 4 + jsdom + RTL). Coverage gate via v8 over `app/api/**` + `lib/**`: lines 87.41%, statements 84.40%, functions 83.33%, branches 72.97%. Major additions from Phase 2 (grounding + Silence Protocol):
  - `tests/unit/lib/ai/grounding.test.ts` — `verifyGrounding`: SBLGNT authority (refuse on mismatch/unresolved), WEB strip-and-caveat, threshold 0.90, cache behavior, infra-error propagation
  - `tests/unit/lib/text/similarity.test.ts` — `levenshtein`, `normalizeGreek`, `normalizeEnglish`, `containmentScore`
  - `tests/unit/lib/references.test.ts` — `parseReference` (book aliases, chapter:verse, edge cases)
  - `tests/unit/lib/ai/synthesis.test.ts` — structured JSON output format (`answer` + `claims[]`), `buildRefusalAnswer`
  - `tests/unit/lib/ai/assistant.test.ts` — grounding gate: ungrounded draft → withheld refusal stored; `grounded` flag on answer
  - `tests/unit/components/AiAssistant-grounding.test.tsx` — "Withheld — insufficient evidence" banner renders when `grounded === false`
  - `tests/unit/api/assistant-route.test.ts` (extended) — `grounded` + `groundingReport` persisted in `AssistantMessageMetadata`

  Earlier additions (Phase 3.0 sprints):
  - `tests/unit/api/assistant-route.test.ts` — prompt cap, oversize 413, malformed 400, rate-limit 429 with `Retry-After`, 401 unauthenticated, AiSession user-scoping
  - `tests/unit/api/generated-study-notes.test.ts`, `tests/unit/api/import-runs.test.ts` — full route coverage (auth + validation + scoping)
  - `tests/unit/lib/auth.test.ts` — `requireAuth`/`requirePageAuth`/`getOptionalUserId`
  - `tests/unit/lib/auth-session-revocation.test.ts` — JWT revocation watermark (iat vs `sessionsValidFrom`)
  - `tests/unit/lib/http-validation.test.ts` — `readJsonLimited` + `validateBody` + `jsonError`
  - `tests/unit/lib/http-security.test.ts` — `assertSameOrigin` cross-origin gate
  - `tests/unit/lib/rate-limit.test.ts` — token bucket, IP-header trust, serverless detection
  - `tests/unit/config/next-headers.test.ts` — CSP / X-Frame / X-Content / Referrer / Permissions / HSTS config asserted per environment
  - `tests/unit/components/AiAssistant-output-safety.test.tsx` — XSS payloads in assistant response render as text, not parsed HTML
  - Plus all earlier suites still in place: highlights, notes, saved-searches, search helpers, import parser, etc.
- **DB integration suite** (`tests/integration/db-ownership.test.ts`, 7 tests) — real Prisma against the configured PostgreSQL. Covers per-user scoping for notes/highlights/saved-searches/generated-notes/ai-sessions plus the `onDelete: Cascade` FK chain from `User`. Runs via `npm run test:integration` through a separate `vitest.integration.config.ts`; skips itself when `DATABASE_URL` is unset.
- **Playwright acceptance suite** (`scripts/acceptance-test.js`) — 11 end-to-end interactions including dev-credentials sign-in. Includes a PostgreSQL preflight that fails fast with a clear message when Docker isn't running.

### Database

- Prisma 6 over PostgreSQL on `localhost:5433`
- 6 migrations on disk:
  - `0_init` — baseline reflecting pre-rename schema
  - `20260521162527_assistant_message_metadata` — `AiMessage.citations → metadata`
  - `20260522193249_token_lemma_index` — composite `(corpusId, bookId, partOfSpeech, lemma)` for `getTopLemmas`
  - `20260524083541_add_english_word_index_to_highlight` — `Highlight.englishWordIndex Int?` + index on `(userId, verseId, englishWordIndex)` (PR 14)
  - `20260526022206_auth_user_models` — Sprint 2: `User` / `Account` / `Session` / `VerificationToken` + FK relations from `Note` / `Highlight` / `SavedSearch` / `GeneratedStudyNote` / `AiSession` to `User.id` (`onDelete: Cascade`)
  - `20260526200447_session_revocation` — Sprint 4: `User.sessionsValidFrom DateTime?` watermark that rejects replayed JWTs after sign-out

### Tech stack

- Next 15.5 / React 19 / TypeScript 5.8
- Auth.js v5 (`next-auth@beta`) + `@auth/prisma-adapter`, JWT session strategy with DB-backed revocation watermark
- zod 3 for request body validation
- OpenAI Node SDK v4 (shared client in `lib/ai/openaiClient.ts`, env-driven timeout, `maxRetries: 1`)
- Vitest 4 / Vite 6 / oxc JSX transform, v8 coverage provider
- @testing-library/react 16 + jsdom 29
- Playwright for acceptance tests

## Known outstanding items

### Security: PostCSS moderate advisory (upstream-blocked)

**postcss <8.5.10** (GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS stringify), bundled inside Next 15. Tracked in `docs/security-register.md` with mitigation rationale: PostCSS only runs at build time over our own CSS, never on untrusted input. **No action available** until Next bumps its bundled postcss. Re-run `npm run security:audit` after each Next release.

### Grounding verifies declared claims only

The Silence Protocol checks the structured `claims[]` the synthesis model emits, not arbitrary
references written inline in the prose answer. An answer that cites a verse inline without a
matching claim entry is not verified (empty `claims[]` is grounded by construction). Low risk
given the synthesis prompt requires a claim per textual claim; a prose-sweep hardening is a
Phase 6 follow-up.

### Branch coverage at 66.53% (gate at 65%)

The lines/statements/functions thresholds are at 80/80/75 with comfortable headroom. Branches are tighter and will need targeted tests in `lib/ai/assistant.ts` and `lib/search.ts` before raising the branch gate above 70.

### Deferred from the 2026-05-21 code review

- **L14: Always-on local retrieval** — flagged-only; no behavior change required at this severity. Revisit if synthesis cost or latency becomes a concern.
- **L17: URL-driven reader navigation** — ✅ closed by PR 2 (prev/next chapter), PR 5 (`?verse=N` anchor), PR 11 (verse-number input), PR 12 (`ReaderLocationMemo` last-passage restore + bottom ChapterNav), PR 16 (`ReaderControls` URL resync).
- **L18: Per-row AiMessage metadata size** — flagged-only. Today the metadata JSON includes the full citations array and tool trace per assistant message. If this grows pathologically, prune to citation refs only and rehydrate on demand.

### Documentation gaps

- No developer onboarding doc for the dispatch table — a new contributor adding a sixth branch has to read the existing four to learn the pattern.

## Milestone 3 — High-Fidelity NT Exegesis (approved 2026-05-28)

The next major arc is **Milestone 3**, which brings the mechanisms from
`docs/Technical Architecture for High-Fidelity Biblical Exegesis.md` to the existing NT corpus.
Scope is locked to an **NT-Greek subset** (no OT Hebrew/Aramaic, Strong's, or speaker data yet);
Louw-Nida enrichment is in scope since the data already ships in the MACULA TSV. Full roadmap,
reconciliation/gap analysis, and the Docker→Neon hosting plan live in
**`docs/HiFi-exegesis-nt-roadmap.md`**. The 6 phases:

1. **Orchestration upgrade** — ✅ **done** (branch `milestone-3/phase-1-orchestration`). Replaced the
   five-branch dispatch table with the Paradigm C deterministic-first pipeline
   (`lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`, `lib/ai/synthesis.ts`; `assistant.ts` is now
   pure orchestration). Real scholarly escalation is wired: `routeAssistantPrompt(prompt, escalate)`,
   a user-confirmed `escalate` flag on `POST /api/assistant`, and a "Use scholarly model" affordance
   in `AiAssistant`. This subsumes the old "Step 3". Unit/tsc/lint/build/coverage all green; DB
   integration + Playwright acceptance to be run against a Neon test branch.
2. **Grounding + Silence Protocol** — ✅ **done** (branch `milestone-3/phase-2-grounding`). SBLGNT citation spine; WEB display-aid with strip-and-caveat (non-fatal); structured synthesis `claims[]`; verification before persistence (withheld refusal stored, never the draft); `grounded` flag + withheld banner in `AiAssistant`. New: `lib/ai/grounding.ts`, `lib/text/similarity.ts`, `lib/references.ts`.
3. **Lexical FTS** — `tsvector` + GIN, ranked keyword search.
4. **Vector + hybrid retrieval** — pgvector, embeddings, RRF, cross-encoder rerank, V±2 windows (heaviest).
5. **Louw-Nida enrichment** — import the `domain`/`ln` columns already in the MACULA TSV.
6. **Evaluation harness** — RAGAS-style faithfulness/context-precision gates.

The "Logical next steps" below remain valid as smaller increments; Step 3 in particular is absorbed
into Milestone 3 Phase 1.

## Logical next steps

Listed in roughly the order they make sense to tackle, with rough effort sizing.

### 1. Step 3: Scholarly Mode V1 — ✅ done (delivered in Milestone 3 Phase 1)

Implemented on branch `milestone-3/phase-1-orchestration`: `routeAssistantPrompt(prompt, escalate)`
escalates to `gpt-5.4` only on a user-confirmed `escalate` flag (never automatically); the flag is
accepted by `POST /api/assistant`, persisted via the existing `AiMessage.metadata.modelRole`, and
surfaced as a "Use scholarly model" button in `AiAssistant`. Original description retained below.

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

- `**searchKeyword` and `searchMorphology` unit tests** — currently only `searchLemma` and `findLemmaExamples` have direct unit coverage. The shape is similar; mostly copy-and-adapt.
- **Empty-retrieval safe response** — the milestone plan calls for "empty retrieval produces a safe no-evidence response" but no unit test exists for the path where every search returns zero results.
- **Scholarly-recommendation routing test** — the milestone plan calls for "Scholarly prompts can return `recommendedUpgrade`, but no Milestone 2.5 path calls gpt-5.4." Worth a direct test that asserts the upgrade is advisory-only today (and won't be regressed when Step 3 lands).

### 4. Dev onboarding doc (S-sized)

The README is current as of PR 16. Still worth a short dev-facing doc for:

- The dispatch-table extension pattern (how to add a new retrieval branch).
- The `HighlightPalette` component pattern (used by both `HighlightMenu` and `EnglishWordPopover`).
- The migrations folder convention (proper Prisma migrations since the M2.5 code review).
- Custom DOM events for cross-instance state (`textlab:highlight-color-change`).

### 5. Step 5: Import parser tests (S-sized backlog) — partially complete

The milestone plan calls for:

- ✅ WEB USFM cleaning tests (footnotes via `\f...\f`*, cross-references via `\x...\x*`, `\w` / `\+w` / Strong's residue) — covered by the 9 `parseUsfm` tests in `tests/unit/scripts/import-open-bible.test.ts` (PR `d754ffe`)
- ✅ MACULA Pericope Adulterae override application — 5 dedicated `parseMaculaTsv` tests
- ⏭️ MorphGNT morphology normalization tests — still backlog
- ⏭️ Importer failure paths (missing WEB dir, failed MorphGNT fetch, partial rollback) — still backlog

The first two are closed by post-PR-16 work. Remaining items are sound investment before any future corpus expansion (OT/LXX/Hebrew Bible).

### 6. Step 6: Notes workflow polish (M-sized)

Once Step 3 (Scholarly Mode) and Step 4 (Reader Nav) land, the notes flow becomes the next-most-friction surface:

- Link generated study notes to the structured citations they were built from (today the link is implicit via prompt text).
- Filter notes by reference / tag / note type.
- Edit flow from assistant answer → saved note (today it's an export-or-discard binary).

### 7. Step 7: Corpus and import visibility (S-sized)

An admin/settings page that surfaces: which corpora are imported, verse/token counts per corpus, last import time. Useful for local development and for catching incomplete imports.

### 8. Production-readiness work — ✅ substantially complete (Phase 3.0)

Phase 3.0 (Sprints 1–4) closed the production-readiness blockers that this section originally tracked:

- ✅ Auth integration — Auth.js v5 with the Prisma adapter; GitHub OAuth in prod, dev Credentials behind `AUTH_DEV_ENABLED=1`
- ✅ User-scoped tables and migrations — `User` / `Account` / `Session` / `VerificationToken` with FK chains and `onDelete: Cascade` from every user-owned table
- ✅ Authorization checks in every API route — `requireAuth` (401) + ownership filters scoped to `session.user.id`
- ✅ Session management — JWT with revocation watermark (`sessionsValidFrom`) so replayed cookies after sign-out are rejected
- ✅ Browser hardening — CSP, X-Frame, X-Content, Referrer, Permissions, HSTS, same-origin gate on mutations
- ✅ Validation, rate limiting, body-size caps on all mutation routes
- ✅ Coverage gate at 80/80/75/65 over server-side runtime

What's still outside Phase 3.0 scope for a real public launch:

- A hosted PostgreSQL (not Docker on `localhost:5433`)
- Production OAuth credentials and a stable `AUTH_URL`
- Move the in-memory rate limiter to Upstash / Vercel KV / Cloudflare KV before deploying to a serverless host (the current limiter no-ops on serverless by design)

## Decision points

A few open questions that aren't blockers but will need a call before the next vertical slice:

1. **Where does L18 (per-row metadata size) need to land?** As long as assistant sessions stay short, the current shape is fine. If you start using the assistant heavily, watch the size of `AiMessage.metadata` rows. Pruning citations from the persisted metadata (keep only refs, rehydrate on read) is a small refactor — but only worth doing if rows actually grow.
2. **Does Step 3 introduce streaming?** The milestone plan explicitly says no streaming in Step 2. Step 3 could go either way. Streaming would be a meaningful UX upgrade for scholarly answers (which take longer), but it would expand the API contract.
3. **Will the bundle-time postcss advisory actually get fixed upstream?** If Next 16.0 stable lands with patched postcss, we get the fix for free. If 16.x lingers on 8.4.31, the project may need to swap postcss-loader manually. Not urgent — flag for the next dep-bump cycle.

## Quick reference

### Verify a clean state

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run verify          # lint + tsc + build + coverage gate
npm run test:integration # real-Prisma ownership + FK suite (needs Docker)
npm run test:acceptance  # Playwright end-to-end (needs Docker)
```

All three should exit 0.

### Start the dev server

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run dev
```

App at [http://localhost:3000](http://localhost:3000). With `OPENAI_API_KEY` set (system env or `.env`), assistant runs in live mode; without it, deterministic local-retrieval fallback.

### Re-audit dependencies

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run security:audit
```

Expected residual until Next bumps bundled postcss: 1 moderate (GHSA-qx2v-qp2m-jg93). See `docs/security-register.md` for the mitigation rationale. The `NODE_OPTIONS=--use-system-ca` env var is persisted at user scope on the maintainer's Windows machine so the registry TLS chain validates against the Windows root store; see `docs/security-register.md` for background on why and for the `NODE_EXTRA_CA_CERTS` alternative.