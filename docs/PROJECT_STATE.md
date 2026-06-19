# TextLab Bible — Project State

*Snapshot: 2026-06-17 (Milestone 3 complete — Phase 4a Vector + Hybrid Retrieval, Phase 4b Voyage rerank-2.5 via Vercel AI Gateway, Phase 5a semantic-domain data + popover display, Phase 5b `/search` domain mode + assistant domain routing, and Phase 6 two-tier eval harness: deterministic type-aware PR gate + weekly hybrid faithfulness report — followed by the `/search` UI improvement arc (PRs 19–21): high-impact reader-linked results + segmented modes, medium pagination/label/morphology-tooltip refinements, and accessibility + visual polish; most recently, domain (Louw-Nida) searches became saveable like the other three modes; English keyword search stems via Snowball — `love` matches `loves`/`loved`/`loving` with stem-aware `ts_headline` highlighting; and keyword search now matches every word (no stopword dropping — `just`, `no`, `own`, `all`… all return results), with stopword filtering confined to the Assistant's `STOP_WORDS`; Greek whole-lexeme matching unchanged; most recently, a review-driven Read-page arc (Phases A–C) landed cookie-backed server-rendered reader prefs + loading skeleton + optimistic highlighting, then a reading-experience redesign — passage masthead, sticky wayfinding bar, inline verse numbers, per-chapter corpus headers, capped single-column measure, and an on-demand note editor)*

## Where the project stands

Milestone 2.5 (retrieval-first multi-model assistant foundation) is on `main`. On top of that, a three-pass UI review documented **55 findings** which were addressed across PRs 1–11; PRs 12–16 then added follow-up features and UX refinements based on hands-on testing. After PR 16, a single follow-up commit (`d754ffe`) closed three import-accuracy bugs surfaced during hands-on reading. The four-sprint **Phase 3.0 security and testing remediation** landed real authentication, request hardening, browser-security headers, and a coverage gate — see [Phase 3.0 remediation](#phase-30-security-and-testing-remediation-sprints-14) below. **Milestone 3 is now complete for the NT-Greek subset**: Phase 4a vector/hybrid retrieval, Phase 4b rerank, Phase 5 Louw-Nida enrichment/domain search, and Phase 6 evaluation harness have landed. The Phase 6 GitHub Actions workflows are added and manually activated with repo secrets plus `Eval Gate / gate` branch protection as of 2026-06-09; remaining work is tracked below as calibration, product polish, operational hardening, and deferred corpus-expansion follow-ups.

### UI review remediation (PRs 1–11) — closed

- **Pass 1: Functional bugs** — 15 findings (4 critical, 6 moderate, 5 minor) — 100% closed
- **Pass 2: Layout & sizing** — 12 findings (1 critical, 6 moderate, 5 minor) — 100% closed
- **Pass 3: UX & design quality** — 28 findings (2 critical, 15 moderate, 11 minor) — 100% closed, including a 12-finding design-identity epic (PR 10/11) that adopted an editorial-scholar aesthetic — Spectral display serif + Inter Tight UI sans + Gentium Plus for polytonic Greek, a derived accent palette from `#365f7e`, codex left-rule pattern, paper-grain background.

Review docs at `docs/archived/ui-review/pass-{1,2,3}-*.md`. Every finding carries a `✅ Fixed in PR<N>` annotation.

### Post-review feature work (PRs 12–16)

Surfaced through use after the formal review closed:

- **PR 12** — Reader: bottom ChapterNav, `ReaderLocationMemo` restores last-visited passage from localStorage, `HighlightMenu` "Clear" swatch + DELETE endpoint, cross-instance color sync via custom DOM event.
- **PR 13** — Search: match highlighting on result verses (keyword query / lemma surface), in-input Search + Clear buttons replacing the external submit.
- **PR 14** — Reader: **per-word English highlighting** with per-word color popover, mirroring the Greek-token UX. Schema gained `Highlight.englishWordIndex Int?` (4th Prisma migration); `HighlightPalette` extracted from `HighlightMenu` for reuse by `EnglishWordPopover`.
- **PR 15** — Removed vestigial verse-level "Highlight verse" button after PR 14 made highlighting fully per-word.
- **PR 16** — Reader: `ReaderControls` resyncs dropdowns to URL after location restore. Notes: tag filter is now a select (`All tags` / `verse` / `word`), new keyword search input on the filter row, where-clause refactored to AND-of-conditions so keyword + reference + tag compose cleanly.

### Search UI improvements (2026-06, PRs 19–21)

A three-phase pass over the `/search` surface, sequenced high-impact → medium refinements → accessibility + visual polish. The query helpers also feed the assistant's retrieval planner, so the morphology normalization is shared, not UI-only.

- **PR 19 (Phase 1, high-impact)** — Result references ("John 1:14") are now links into the reader (`/read?book&chapter&verse`) via a new `readerHref` helper in `lib/references.ts`; keyword hits that fall outside the SBLGNT spine (WEB-only verses like Acts 8:37) render as plain text — `searchKeyword` annotates each result with an `onSpine` flag using the existing spine filter. `SearchPanel` remounts when URL search state changes (new `lib/searchStateKey.ts`), fixing stale form controls after client-side navigation (e.g. clicking a saved search). The mode `<select>` became a segmented radio control (Keyword / Lemma / Morphology / Domain) with per-mode placeholders, hint text, forced-colors (High Contrast) support, and unknown-mode fallback. The empty state shows clickable example-search chips for all four modes; the no-results state gives per-mode recovery guidance (the stale "sample-data" copy is gone).
- **PR 20 (Phase 2, medium refinements)** — The results label now includes mode and scope: `116 results for lemma "λόγος" in John` (new `lib/searchLabel.ts`). Morphology codes on token results carry human-readable tooltips via a new `lib/morphology.ts` decoder ("V-3PAI-S" → "verb — present active indicative, 3rd person singular"), covering nominals, finite verbs, participles, infinitives, pronouns (incl. genderless forms), and degree. `searchMorphology` normalizes Robinson-ordered query codes (`V-PAI-3S`, R=perfect, M=imperative, dashed participles) to the stored MorphGNT scheme via `normalizeMorphCodeQuery` before matching — benefiting both the `/search` UI and the assistant's retrieval planner. `prisma/seed.ts` sample data was realigned from the Robinson-style codes to the MorphGNT-derived scheme the importer produces (one scheme everywhere). Saved searches show friendly book names (at the time, domain mode explained saving wasn't yet supported; a later PR made domain searches saveable — see Milestone 3 Phase 5). Pagination shows absolute ranges (`Showing 26–50 of 116`) and overshooting `?page=` URLs are refetched at the clamped page; page size is a select (10/25/50/100); the chapter filter is numeric and disabled until a book is chosen (a book-less chapter URL param is ignored server-side rather than filtering invisibly). Domain mode has a standalone Search button, and saved searches persist the executed search's mode (not a toggled-but-unsubmitted one). `scripts/acceptance-test.js`: the results-label assertion was updated and Chrome's Next-asset preload-timing warning allowlisted as benign noise.
- **PR 21 (Phase 3, accessibility + visual polish)** — Status messages ("Search saved.", rename/delete feedback) announce via always-rendered aria-live regions; the saved-search rename input has an accessible name; disabled pagination renders as text instead of focusable dead links. Result rows get a codex-rule hover treatment (2px accent left rule), and the search form is sticky at xl width on long result lists.

### Read page improvements (2026-06)

Review-driven pass over `/read` (plan: `docs/superpowers/plans/2026-06-17-read-page-improvements.md`). Phases A–E (the review-finding pass) have shipped, plus feature phases F (reference quick-jump) and G (continuous reading mode).

- **First-load stability (Phase A)** — reader mode, last passage, and intro dismissal moved from post-hydration `localStorage` reads to cookies the server reads on first paint, eliminating the parallel-flash / intro-blink / redirect-refetch sequence.
- **Perceived performance (Phase B)** — route-level `app/read/loading.tsx` skeleton; highlighting is optimistic (removed the per-toggle full-passage `router.refresh`), unifying the Greek and English feedback paths.
- **Reading experience (Phase C)** — passage masthead replaces the generic "Reader" title; sticky wayfinding bar; inline verse numbers (one heading per chapter); per-chapter corpus headers; capped reading measure in single-column modes; on-demand note editor with an `aria-live` save-status region; accent (not amber) target ring and raised contrast on the corpus labels.
- **Accessibility (Phase D)** — shared `focus-visible` rings (`lib/ui/focus.ts`) across every reader and popover control; `prefers-reduced-motion` honored for scrolling and animations; aria-live status regions for note saves; larger (~36px) highlight-swatch tap targets.
- **Copy / polish (Phase E)** — reader-facing empty state with a way back; chapter dropdown shows the chapter number only; raised contrast on low-contrast text (Louw-Nida references); the morphology λ is purely decorative; and only one word popover stays open at a time.
- **Reference quick-jump (Phase F)** — type a free-text passage reference ("John 3:16", "Rom 5", "1 cor 13:4") to jump straight there; available in the always-visible sticky bar (so you can navigate without scrolling up), reusing the existing reference parser via `parsePassageQuery`. The sticky-bar `Go` button uses the primary accent style to match the other reader buttons. A later follow-up (2026-06) widened `parsePassageQuery` to also accept a `.` as the chapter:verse separator (`Rom 8.18` as well as `Rom 8:18`); `parseReference` (search/assistant) stays colon-only. Book abbreviations with a trailing period (`Rom.`) are still out of scope.
- **Continuous reading mode (Phase G)** — a Study/Continuous layout axis independent of Greek/English/Parallel, cookie-backed and server-rendered. Continuous flows the passage as prose with superscript verse numbers and hides the per-verse note editors; it is single-language only (disabled in Parallel, which falls back to Study). The shared word renderers (`GreekToken`/`EnglishWords`) were extracted to `components/readerTokens.tsx` so both `BibleReader` and the new `ContinuousReader` reuse them (no circular import); highlighting stays optimistic and the morphology popover stays fully functional. Continuous verses carry a visually-hidden reference (`sr-only`) so screen readers retain verse boundaries.
- **Notes on the Read page (Phase H)** — `getReaderPassage` now returns note bodies + tags for both tokens and verses; a passage notes drawer leads the sticky-bar controls (grouped by reference, jump-to-verse, hidden when the chapter has no notes) and `NoteList` lists appear inside the morphology popover and the study verse area, all with inline edit/delete over the existing `PATCH`/`DELETE` `/api/notes/[id]` routes (note mutations trigger `router.refresh()` since notes are not optimistic).

### Post-Phase-3.0 bug fixes

#### Synthesis prompt bug (2026-05-27)

The assistant previously reused a shared assistant prompt string that contained the directive *"first call the relevant search or passage tool."* In the synthesis-only path, that produced prose tool-call invocations instead of an answer when no tools were registered. The live model instructions now live in `lib/ai/synthesis.ts` as `SYNTHESIS_SYSTEM_PROMPT` and make the synthesizer role explicit: retrieval is already done, answer from the supplied evidence, and only use the registered `getPassage` refinement tool for critical missing adjacent context. The assistant page's guardrails panel is intentionally separate display copy in `lib/ai/assistantGuardrailsDisplay.ts`, not the exact model prompt. Tests in `tests/unit/lib/ai/synthesis.test.ts` and `tests/unit/lib/ai/assistantGuardrailsDisplay.test.ts` lock this down. Also fixed: `.claude/**` was not in the ESLint `ignores` list, causing stale worktree build artifacts to be linted.

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
| `/read` | Passage reader; clickable Greek tokens with morphology popover; **per-word English highlighting** with color palette popover; verse-jump input + free-text reference quick-jump, prev/next chapter (top + bottom), Greek/English/Parallel mode toggle, **Study/Continuous layout toggle** (continuous = single-language flowing prose), last-passage restore |
| `/search` | Four modes on a **segmented control** (Keyword / Lemma / Morphology / Domain) with per-mode placeholders + hint text, empty-state example chips, and per-mode no-results guidance. **Match highlighting** on result verses (stem-aware `ts_headline` per row); result references **link into the reader** (off-spine keyword hits stay plain text). Mode+scope results label (`116 results for lemma "λόγος" in John`); **morphology tooltips** decode result codes; **friendly pagination** with absolute ranges + page-size select; numeric chapter filter **disabled until a book is chosen**; saved searches show friendly book names and persist the executed mode; aria-live status/rename/delete announcements. Keyword mode uses FTS with per-corpus configs and `websearch_to_tsquery`: English (WEB) rows use `bible_english` (Snowball stemming — `love` matches `loves`/`loved`/`loving`; every word matches — no stopword dropping in the FTS config); Greek (SBLGNT) rows use `bible_simple` (accent-insensitive, whole-lexeme, not stemmed); both support multi-word AND and optional rank ordering. Morphology mode normalizes Robinson-ordered query codes to the stored MorphGNT scheme before matching. **Domain mode** (Phase 5b) queries Louw-Nida semantic domains via a domain dropdown (`33 — Communication`), a dependent subdomain dropdown, and a free-text LN-reference field (`33.55`); domain searches are saveable like the other three modes and round-trip from the sidebar back to a full domain search URL. |
| `/assistant` | AI Study Assistant — retrieval-first with live/fallback mode indicator, codex-gutter sidebar (trace + citations + generated notes) |
| `/notes` | Notes index with **keyword search**, tag dropdown filter, reference filter, sort (Most recent / Canonical / Title), server-side pagination |
| `/api/assistant` | POST endpoint: auth-gated, prompt cap, rate-limited (10/min, `Retry-After`); dispatches local retrieval and optionally synthesizes via OpenAI Responses API |
| `/api/notes`, `/api/saved-searches`, `/api/saved-searches/[id]`, `/api/highlights` (POST + DELETE), `/api/import-runs`, `/api/generated-study-notes` | CRUD endpoints — all auth-gated (401), validated (zod), same-origin (403 cross-origin), 16 KB body cap (`/api/generated-study-notes` allows a 256 KB body — answer ≤ 64 KB, markdown ≤ 72 KB — to persist full-passage assistant answers) |
| `/signin` | Custom sign-in page; styled card matching the editorial-scholar palette. Renders the dev-credentials form (when `AUTH_DEV_ENABLED=1`) and a GitHub OAuth button (when `GITHUB_CLIENT_ID/SECRET` are set). Redirects authenticated visitors back to `/read`. Surfaces inline errors from server-action validation and Auth.js `?error=` redirects. |
| `/api/auth/[...nextauth]` | Auth.js v5 catch-all — provider callbacks (GitHub OAuth in prod, dev Credentials behind `AUTH_DEV_ENABLED=1`), session, signout. User-facing sign-in lives at `/signin`. |

### Assistant pipeline

The assistant route follows a clear retrieval-first contract:

1. **Route the prompt** (`routeAssistantPrompt`) — returns `{ modelRole, modelUsed, routingDecision }` and an optional advisory `recommendedUpgrade` if scholarly cues are detected.
2. **Run local retrieval first** (`extractSignals` → `runRetrievalPlan`) — the Paradigm C deterministic-first pipeline (`lib/ai/signals.ts`, `lib/ai/retrievalPlanner.ts`): signals are extracted from the prompt, `buildPlan` turns them into a bounded set of DB-backed calls (passage/lemma/keyword/morphology/top-lemmas), and `runRetrievalPlan` executes them into an `EvidencePacket` (citations, tool trace, formatted evidence). Signal extraction parses cross-chapter references (e.g. `2 Cor 4:16–5:10`) via `ParsedReference.chapterEnd`, matches book aliases longest-first, strips parsed references/book aliases/morphology codes before topic extraction, preserves known and quoted multi-word phrases as `phraseTerms`, and maps stable entity topics (`jesus`, `christ`, `god`, `lord`, `jerusalem`) to Greek lemmas instead of dropping them as proper nouns. The retrieval planner applies these completeness rules with bounded, safe assembly: (a) word searches (`searchLemma`/`searchKeyword`/`searchMorphology`) are scoped to a chapter only for exactly one single-chapter reference; multiple references in one book use book scope, and cross-book prompts stay corpus-wide; (b) large surveys return 25 results plus the true total count (e.g. `searchLemma(ἀγάπη) — 116 hit(s) … (91 more)`), while small ones (≤ 25 hits) return all results; (c) `passageCall` assembles complete passages — whole chapters, in-chapter ranges, and cross-chapter ranges built from per-chapter `getPassage` calls — subject to a `MAX_PASSAGE_LINES = 120` hard ceiling with a `…(N more)` marker. Cross-chapter expansion is bounded against pathological prompts (the chapter span is clamped, the fetch loop stops once a chapter returns no rows, it probes past a leading out-of-range segment so a valid tail is not dropped, the tool trace lists only chapters actually fetched, and an explicit truncation marker is shown when the ceiling cuts a span short). (d) The total assembled evidence is capped at `MAX_EVIDENCE_CHARS = 58_000` (with an honest omission marker): the deterministic-fallback answer embeds the evidence verbatim and the user may save it, so this keeps that answer within the generated-study-note persistence caps by construction — single/few-reference answers are never trimmed; only a pathological multi-range prompt is. (e) **Phase 4a semantic path**: on conceptual prompts with real topic words or phrase terms, the planner also runs a gated `semanticCall` outside the deterministic 8-call budget — `searchSemantic` fuses pgvector KNN over current-model WEB verse embeddings with keyword FTS via Reciprocal Rank Fusion (`lib/search/rrf.ts`), filters hits to the SBLGNT spine, and expands each hit to an on-spine ±2 verse window. Semantic search skips morphology-only prompts and exact-verse lookups, honors the same book/chapter scope as deterministic retrieval, requires `OPENAI_API_KEY`, and gracefully no-ops to deterministic retrieval when unset or disabled. (f) **Phase 4b rerank**: after the SBL-spine filter, `searchSemantic` reranks the candidate pool (top-30 → top-5) on WEB text via Voyage rerank-2.5 through Vercel AI Gateway (`lib/search/rerank.ts`, AI SDK `rerank`), gated on `AI_GATEWAY_API_KEY`; on missing key / error / timeout it falls back to the RRF order (graceful no-op), so behavior is unchanged when the key is unset.
3. **Optionally synthesize** (`synthesizeWithRefinement`) — when `OPENAI_API_KEY` is set, calls the official `openai@4` SDK's `responses.create` with the local answer + citations (capped at 20 entries) + structured tool trace as context. The model returns structured JSON (`answer` + `claims[]`) via a strict json\_schema output format. Throws are caught and the deterministic local answer is returned with `mode: "fallback"`.
4. **Verify grounding** (`verifyGrounding` in `lib/ai/grounding.ts`) — each claim's cited reference is resolved and the quoted text is fuzzy-matched against the real DB verse. SBLGNT is the citation authority: a Greek-quote score below 0.90 or an unresolvable reference fails the claim and `answerBibleQuestion` returns a structured refusal (`grounded: false`) instead of the draft — the withheld answer is what gets stored, never the draft. WEB is a non-authoritative display aid: a WEB mismatch or missing verse appends an alignment caveat but does not refuse. The `grounded` boolean and optional `groundingReport` are recorded in `AssistantMessageMetadata`; `AiAssistant` renders a "Withheld — insufficient evidence" banner when `grounded === false`. Deterministic fallback paths are grounded-by-construction; a verification infra-throw falls back deterministically.
5. **Persist the exchange** — `startAssistantExchange` initiates the user-message DB write before `answerBibleQuestion` runs (parallelizing the user write with synthesis); `finishAssistantExchange` writes the assistant message with typed `AssistantMessageMetadata` JSON (including `grounded` + `groundingReport`).

### Test surfaces

- **Unit and integration tests** (vitest 4 + jsdom + RTL). Coverage gate via v8 over `app/api/**` + `lib/**`. Additions from Phase 5b (Louw-Nida domain search):
  - `tests/unit/lib/search-domain.test.ts` — `searchDomain` (domain / subdomain / LN-reference filters, domain→subdomain code expansion, book/chapter scope, pagination) and `getLouwNidaDomainOptions` (level-1 domains + dependent level-2 subdomains)
  - `tests/unit/lib/ai/signals.test.ts` (extended) — `detectDomainQuery`: explicit-only, anchored detection of `domain 33` / `LN 33.55`; never trips on chapter:verse notation like `John 3.16`; domain-number range validation
  - `tests/unit/lib/ai/retrievalPlanner.test.ts` (extended) — `domainCall` from a `domainQuery` signal
  - `tests/integration/louw-nida-search.test.ts` — end-to-end domain search against the seeded Neon test branch (GIN-backed LN-reference and domain/subdomain membership queries)

  Additions from Phase 5a (Louw-Nida enrichment):
  - `tests/unit/lib/louwNida.test.ts` (7 tests) — `flattenLouwNidaDomains`: full taxonomy JSON → rows with level/parentCode; `resolveTokenDomains`: code-array → display-label `TokenDomainSense[]`, multi-domain, missing code, empty input
  - `tests/unit/scripts/import-open-bible.test.ts` (3 new cases) — `parseMaculaTsv` Louw-Nida columns: `ln` and `domain` parsed into arrays, empty/missing values produce empty arrays
  - `tests/integration/louw-nida.test.ts` — reference table seeded (738 rows), codes present on tokens (including the Pericope-Adulterae insert path), GIN array-membership query (`lnDomain` has member)

  Additions from Phase 4a (Vector + Hybrid Retrieval):
  - `tests/unit/lib/search/rrf.test.ts` — `reciprocalRankFusion` unit tests (RRF score computation, tie-breaking, empty-list edge cases)
  - `tests/unit/lib/search-semantic.test.ts` — `searchSemantic`: vector KNN + FTS fusion, SBLGNT-spine filter, current-model filter, embedding text-hash helper, chapter scope, and behavior when `OPENAI_API_KEY` is unset
  - `tests/unit/lib/ai/signals.test.ts` (extended) — longest-first book aliases, reference/book/morph stripping before topic extraction, `describe` as a stop word, entity-topic lemma mappings, and quoted phrase preservation
  - `tests/unit/lib/ai/retrievalPlanner.test.ts` (extended) — `shouldRunSemantic` gate (fires on topical/phrase prompts, skips exact-verse and morphology-only prompts); multi-reference scoping; `semanticCall` on-spine ±2 window assembly
  - `tests/unit/lib/ai/synthesis.test.ts` (extended) — prompt requires exact Greek copying, text-critical sigla preservation, and ellipsis use for omitted Greek spans
  - `tests/integration/semantic-search.test.ts` — end-to-end semantic search against the seeded Neon test branch (with embeddings ingested)
  - `tests/unit/lib/search/rerank.test.ts` — `rerankCandidates`: key-gating (no network without `AI_GATEWAY_API_KEY`), empty-input no-op, `originalIndex`→reference mapping + locally enforced `topN`, malformed / empty / out-of-range rankings → `null`, and error/timeout → `null`

  Additions from Phase 3 (Lexical FTS):
  - `tests/unit/lib/search-keyword.test.ts` (4 tests) — `searchKeyword` FTS behaviour: accent folding, lexeme-not-substring, multi-word AND, rank ordering
  - `tests/integration/fts-search.test.ts` (6 tests) — end-to-end FTS against the seeded test branch

  Major additions from Phase 2 (grounding + Silence Protocol):
  - `tests/unit/lib/ai/grounding.test.ts` — `verifyGrounding`: SBLGNT authority (refuse on mismatch/unresolved), WEB caveat-only, threshold 0.90, cache behavior, infra-error propagation
  - `tests/unit/lib/text/similarity.test.ts` — `levenshtein`, `normalizeGreek`, `normalizeEnglish`, `containmentScore`
  - `tests/unit/lib/references.test.ts` — `parseReference` (book aliases, chapter:verse, edge cases)
  - `tests/unit/lib/ai/synthesis.test.ts` — structured JSON output format (`answer` + `claims[]`), `buildRefusalAnswer`
  - `tests/unit/lib/ai/assistant.test.ts` — grounding gate: ungrounded draft → withheld refusal stored; `grounded` flag on answer
  - `tests/unit/components/AiAssistant-grounding.test.tsx` — "Withheld — insufficient evidence" banner renders when `grounded === false`
  - `tests/unit/api/assistant-route.test.ts` (extended) — `grounded` + `groundingReport` persisted in `AssistantMessageMetadata`

  Additions from retrieval scoping and completeness (`fix/retrieval-scoping`, PR #7):
  - `tests/unit/lib/ai/signals.test.ts` (extended) — cross-chapter reference parsing: `ParsedReference.chapterEnd` is populated for ranges like `2 Cor 4:16–5:10`; single-chapter and intra-chapter ranges leave `chapterEnd` undefined or equal to `chapter`
  - `tests/unit/lib/ai/retrievalPlanner.test.ts` (extended) — `scopeFor` scoping rules (single-chapter → chapter scope, multi-ref / cross-chapter / no-book → book/corpus fallback); size rule (≤ 25 returns all, > 25 returns 25 + true count marker); full passage assembly for whole chapters and cross-chapter ranges; `MAX_PASSAGE_LINES` ceiling with `…(N more)` marker; and the bounding/safety hardening surfaced by automated PR review — clamped + empty-break cross-chapter fan-out (a 1e9 end chapter stays ≤ 8 fetches), probing past a leading empty segment, lazy (no-phantom) tool trace, explicit ceiling-truncation marker, and the `MAX_EVIDENCE_CHARS` total-evidence cap
  - `tests/unit/api/generated-study-notes.test.ts` (extended) — accepts a multi-reference-sized note at the planner's 8-call ceiling; raised answer/markdown (64 KB/72 KB) and 256 KB body caps

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
- **Playwright acceptance suite** (`scripts/acceptance-test.js`) — 11 end-to-end interactions including dev-credentials sign-in. Includes a PostgreSQL preflight that fails fast with a clear message when the configured `.env.test` database cannot be reached.

### Database

- Prisma 6 over PostgreSQL. Current maintainer/dev and test environments use Neon branches (`DATABASE_URL` pooled for runtime, `DIRECT_URL` direct for migrations); local PostgreSQL remains possible if the same migrations are applied.
- 14 migrations on disk:
  - `0_init` — baseline reflecting pre-rename schema
  - `20260521162527_assistant_message_metadata` — `AiMessage.citations → metadata`
  - `20260522193249_token_lemma_index` — composite `(corpusId, bookId, partOfSpeech, lemma)` for `getTopLemmas`
  - `20260524083541_add_english_word_index_to_highlight` — `Highlight.englishWordIndex Int?` + index on `(userId, verseId, englishWordIndex)` (PR 14)
  - `20260526022206_auth_user_models` — Sprint 2: `User` / `Account` / `Session` / `VerificationToken` + FK relations from `Note` / `Highlight` / `SavedSearch` / `GeneratedStudyNote` / `AiSession` to `User.id` (`onDelete: Cascade`)
  - `20260526200447_session_revocation` — Sprint 4: `User.sessionsValidFrom DateTime?` watermark that rejects replayed JWTs after sign-out
  - `20260530120000_lexical_fts` — Phase 3: `CREATE EXTENSION unaccent`; custom immutable `bible_simple` FTS config; `Verse.textSearch` stored GENERATED `tsvector` column; `Verse_textSearch_idx` GIN index; all ~15.9 k rows backfilled
  - `20260602120000_add_verse_embeddings` — Phase 4a: `CREATE EXTENSION vector` (pgvector); `VerseEmbedding` table (WEB per-verse `vector(1536)` + foreign-key to `Verse`); HNSW cosine index.
  - `20260603120000_add_verse_embedding_text_hash` — Phase 4a follow-up: `VerseEmbedding.textHash` so ingestion can detect stale embeddings when WEB text changes. Embeddings are ingested via `npm run embed:verses` (requires `OPENAI_API_KEY`, model `text-embedding-3-small`; idempotent — skips empty verses, retries transient 5xx, and re-embeds when the row is missing, the model differs, or `textHash` differs).
  - `20260606070628_add_louw_nida` — Phase 5a: `Token.louwNida String[] @default([])` and `Token.lnDomain String[] @default([])` columns + GIN index on `lnDomain`; new `LouwNidaDomain` reference table (`code`, `level`, `label`, `parentCode`).
  - `20260607000000_louw_nida_search_index` — Phase 5b: GIN index on `Token.louwNida` (`Token_louwNida_idx`) so LN-reference domain search (e.g. `33.55`) is index-backed.
  - `20260611120000_saved_search_domain_filters` — `SavedSearch` gained nullable `domain` / `subdomain` / `ln` columns and `query` became optional, so domain (Louw-Nida) searches save and round-trip like the other three modes (handwritten; applied via `migrate deploy` to the dev and shared test/eval Neon branches).
  - `20260613120000_english_stem_fts` — `bible_english` immutable config (unaccent + english_stem); `Verse.textSearchEn` generated tsvector + `Verse_textSearchEn_idx` GIN index. English (WEB) keyword search stems via Snowball (`love` matches `loves`/`loved`/`loving`); Greek keeps `bible_simple` whole-lexeme (handwritten; applied via `migrate deploy` to the dev/prod and test/eval Neon branches).
  - `20260613130000_english_stem_no_stopwords` — swaps `bible_english`'s `english_stem` dictionary for a custom Snowball dictionary `english_stem_nostop` (no stopword list) and rebuilds `Verse.textSearchEn` + its GIN index. English keyword search now matches every word (e.g. `just`, `no`, `own`), still stemmed; stopword filtering moves entirely to the Assistant's `STOP_WORDS` (handwritten; applied via `migrate deploy` to the dev/prod and test/eval Neon branches).

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
given the synthesis prompt requires a claim per textual claim; a prose-sweep hardening remains an
open follow-up — it was explicitly **out of scope** for Phase 6 (it is a change to the grounding
verifier, not the eval harness) and is **not** closed by it.

### Phase 6 calibration follow-ups

Surfaced while calibrating the eval gate (see Milestone 3 Phase 6 above):

- **Natural-language range parsing.** The signal extractor parses hyphen/en-dash reference ranges
  (`Matthew 5:1-12`, `2 Cor 4:16-5:10`) but not natural-language ranges ("from X to Y", "X through Y")
  — those retrieve only the start verse. Two golden questions were reworded to the supported notation
  for calibration; teaching `extractSignals`/`parseReference` to parse "to"/"through" ranges is a future
  retrieval-planner improvement.
- **Topical exact-verse retrieval.** An exact-verse question carrying topic words (e.g. "What does
  1 Cor 13:13 say *about faith, hope, and love*?") triggers extra deterministic lemma/keyword searches
  beyond the pinned verse, lowering precision. The golden item was reworded to a clean lookup; whether
  an explicit reference should suppress topic-word fan-out is a planner design question.
- **Domain gate promotion.** Domain queries are currently gate-report-only, but with evidence-based
  recall measurement they score recall = 1.0 against the seeded data. Once the domain golden sets are
  validated and scoped (precision is structurally low — golden is a curated subset of all domain
  matches), domain recall is a candidate to promote into the hard gate.
- **CI + weekly wiring.** Both GitHub Actions workflows are added in `.github/workflows/` and are now
  manually activated: `eval-gate.yml` (deterministic, DB-only, blocking — runs on `pull_request` + `push`
  to `main`) and `weekly-eval-report.yml` (full hybrid pipeline + LLM-judge faithfulness — weekly cron
  every Friday + `workflow_dispatch`, uploads `eval/output/` as an artifact). As of 2026-06-09, repo secrets are set
  for `EVAL_DATABASE_URL` + `EVAL_DIRECT_URL` (seeded Neon test branch — gate + report) and
  `OPENAI_API_KEY` + `AI_GATEWAY_API_KEY` (report only), and branch protection marks `Eval Gate / gate`
  as a **required status check** for `main`. Secrets are recorded in `docs/security-register.md`.

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
`docs/archived/Technical Architecture for High-Fidelity Biblical Exegesis.md` to the existing NT corpus.
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
2. **Grounding + Silence Protocol** — ✅ **done** (branch `milestone-3/phase-2-grounding`). SBLGNT citation spine; WEB display-aid is caveat-only (non-fatal — a misaligned English aid is flagged with an appended caveat but is not yet stripped from the prose; stripping tracked as a follow-up); structured synthesis `claims[]`; verification before persistence (withheld refusal stored, never the draft); `grounded` flag + withheld banner in `AiAssistant`. New: `lib/ai/grounding.ts`, `lib/text/similarity.ts`, `lib/references.ts`.
3. **Lexical FTS** — ✅ **done** (branch `milestone-3/phase-3-lexical-fts`). `bible_simple` unaccent
   config (immutable); `Verse.textSearch` stored GENERATED `tsvector` + `Verse_textSearch_idx` GIN
   index; `searchKeyword` rewritten to `$queryRaw` / `websearch_to_tsquery('bible_simple', …)` —
   the project's first raw SQL in the search layer (all user input bound as `Prisma.sql` parameters);
   new `orderBy: "canonical" | "rank"` param; retrieval planner passes `orderBy: "rank"`. Behaviour:
   accent-insensitive Greek, whole-lexeme (not substring) matching, multi-word AND queries. ✅ English
   Snowball stemming landed 2026-06-13 (`bible_english`/`textSearchEn`; Greek keeps `bible_simple`; stem-aware `ts_headline` highlighting); stopword dropping removed from `bible_english` (`english_stem_nostop` custom dictionary) so every English word matches — stopword filtering is the Assistant's responsibility via `STOP_WORDS`. Evidence-diff harness added
   (`scripts/evidence-diff.ts`). Unit + integration tests all green.
4. **Vector + hybrid retrieval** — ✅ **Phase 4a done** (merged via PR #9): pgvector `VerseEmbedding` table, `text-embedding-3-small` WEB embeddings, `textHash` stale-embedding detection, `searchSemantic` (current-model vector KNN + FTS RRF), SBLGNT-spine filter, on-spine ±2 window expansion, `npm run embed:verses` ingestion, and safer search routing for entity topics, numbered books, morphology prompts, references, and phrases. ✅ **Phase 4b done** (branch `milestone-3/phase-4b-rerank`): cross-encoder rerank via Voyage rerank-2.5 through Vercel AI Gateway; gated on `AI_GATEWAY_API_KEY`; graceful fallback to RRF order on missing key / error / timeout.
5. **Louw-Nida enrichment** — ✅ **Phase 5a + 5b done** (branch `milestone-3/phase-5-louw-nida`, then `milestone-3/phase-5b-domain-search`). **Phase 5a**: `Token` gained `louwNida String[] @default([])` (ln refs, e.g. `33.38`) and `lnDomain String[] @default([])` (MARBLE numeric codes, e.g. `033005`), plus a GIN index on `lnDomain`. New `LouwNidaDomain` reference table (`code` PK, `level`, `label`, `parentCode`) seeded from 738-node UBS JSON (CC-BY-SA 4.0). Migration `prisma/migrations/20260606070628_add_louw_nida/`. `scripts/import-louw-nida.ts` (`npm run import:louw-nida`) idempotently upserts the reference rows; `parseMaculaTsv` now parses `domain`/`ln` columns into code arrays and `importMaculaGreekGlosses` persists them through all three token write paths. `lib/louwNida.ts` provides `flattenLouwNidaDomains` and `resolveTokenDomains` helpers. `getReaderPassage` batch-resolves domain codes to labels; `MorphologyPopover` renders **Domain** and **Subdomain** rows on Greek tokens. **Phase 5b** adds domain-aware retrieval: a GIN index on `Token.louwNida` (migration `20260607000000_louw_nida_search_index`); `searchDomain` + `getLouwNidaDomainOptions` in `lib/search.ts`; the `/search` **domain** mode (domain dropdown `33 — Communication`, dependent subdomain dropdown, free-text LN-reference field `33.55`); and an explicit-only, anchored assistant `domainQuery` signal (`domain 33` / `LN 33.55`, never trips on `John 3.16`) feeding a planner `domainCall`. Saving domain searches was initially out of scope for v1, but later landed: a follow-up PR added nullable `domain`/`subdomain`/`ln` columns (and made `query` optional) on `SavedSearch` via migration `20260611120000_saved_search_domain_filters`, per-mode save validation in the saved-searches API, and a domain-aware Save button on `/search` so domain searches round-trip from the sidebar back to a full domain search URL like the other three modes.
6. **Evaluation harness** — ✅ **done** (branch `milestone-3/phase-6-eval-harness`). A two-tier harness in `eval/` over a ~20-item curated golden set (`eval/dataset/golden-set.json`, all five query types). **Blocking PR gate** `npm run eval:gate`: deterministic, DB-only, **no API key** — a **type-aware** gate (`eval/gate.ts` + `eval/thresholds.ts`): exact-verse + cross-chapter gate recall AND precision (= 1.0); lemma-survey gates recall (precision report-only, structurally low since golden is a curated subset); conceptual + domain are report-only (conceptual is vector-dependent → weekly report; domain until its goldens are validated/scoped). Two global hard gates over all items: **citation resolvability = 100%** (every cited ref resolves to a real SBLGNT verse via `verifyGrounding` over reference-only claims) and **required lemma coverage = 100%**. Context recall is measured over the full retrieved evidence the synthesizer sees (citations ∪ references parsed from `formattedEvidence`), not the ≤10 citation sample. **Non-blocking weekly hybrid report** `npm run eval:report` (`eval/report.ts`, self-contained HTML + JSON): runs the full pipeline (`semanticEnabled=true`) once per question, synthesizes the judged answer from that **same** `EvidencePacket` via `synthesizeWithRefinement`, and scores **faithfulness** with an LLM-as-judge (`eval/judge.ts`) routed through the **Vercel AI Gateway** (`generateObject`, `EVAL_JUDGE_MODEL` default `anthropic/claude-sonnet-4.6`, `EVAL_JUDGE_TIMEOUT_MS` per-attempt, default 30 s, 90 s in the weekly workflow; the judge owns its retries — up to 3 attempts with SDK-parity backoff, `maxRetries: 0` at the SDK level — so judge errors in the report list each attempt's underlying cause instead of the SDK's opaque "Delay was aborted"). The report is **dual-key** (`OPENAI_API_KEY` → embeddings + synthesis; `AI_GATEWAY_API_KEY` → rerank + judge) and records explicit per-question `synthesisStatus`/`judgeStatus`. The gate protects deterministic evidence retrieval + citation safety; the report monitors full hybrid-pipeline quality; generative-hallucination protection lives in the production runtime grounding verifier + the weekly report. Baseline run: gate passes 20/20 (gated types recall = precision = 1.0; both hard gates 100%). GitHub Actions automation is now active: `eval-gate.yml` runs on PRs and pushes to `main`, `weekly-eval-report.yml` runs by cron (Fridays) and `workflow_dispatch`, required repo secrets are configured, and `Eval Gate / gate` is marked required for `main` as of 2026-06-09. See "Phase 6 calibration follow-ups" below.

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

- **`searchMorphology` unit tests** — `searchKeyword` now has direct FTS unit coverage; morphology still lacks the same direct helper-level coverage.
- **Empty-retrieval safe response** — the milestone plan calls for "empty retrieval produces a safe no-evidence response" but no unit test exists for the path where every search returns zero results.
- **Semantic degradation smoke tests** — current unit tests cover no-key behavior; a focused end-to-end smoke for "embedding index empty/partial but deterministic retrieval still answers" would lock the intended graceful-degradation behavior.

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

- Production database policy and branch lifecycle for Neon (the maintainer/dev and test branches exist, but public-launch retention, backups, and storage-budget policy still need an explicit decision)
- Production OAuth credentials and a stable `AUTH_URL`
- Move the in-memory rate limiter to Upstash / Vercel KV / Cloudflare KV before deploying to a serverless host (the current limiter no-ops on serverless by design)

## Decision points

A few open questions that aren't blockers but will need a call before the next vertical slice:

1. **Where does L18 (per-row metadata size) need to land?** As long as assistant sessions stay short, the current shape is fine. If you start using the assistant heavily, watch the size of `AiMessage.metadata` rows. Pruning citations from the persisted metadata (keep only refs, rehydrate on read) is a small refactor — but only worth doing if rows actually grow.
2. **Does Step 3 introduce streaming?** The milestone plan explicitly says no streaming in Step 2. Step 3 could go either way. Streaming would be a meaningful UX upgrade for scholarly answers (which take longer), but it would expand the API contract.
3. **Will the bundle-time postcss advisory actually get fixed upstream?** If Next 16.0 stable lands with patched postcss, we get the fix for free. If 16.x lingers on 8.4.31, the project may need to swap postcss-loader manually. Not urgent — flag for the next dep-bump cycle.

## Quick reference

> The npm scripts bake in `--use-system-ca` via `cross-env`, so none of the
> commands below need a `NODE_OPTIONS` prefix — they work in any shell. Only the
> initial `npm install` still needs the flag in the environment (see Setup in
> `README.md`).

### Verify a clean state

```powershell
npm run verify          # lint + tsc + build + coverage gate
npm run test:integration # real-Prisma ownership + FK suite (uses .env.test / Neon test branch)
npm run test:acceptance  # Playwright end-to-end (uses .env.test / Neon test branch)
```

All three should exit 0.

### Start the dev server

```powershell
npm run dev
```

App at [http://localhost:3000](http://localhost:3000). With `OPENAI_API_KEY` set (system env or `.env`), assistant runs in live mode; without it, deterministic local-retrieval fallback.

### Re-audit dependencies

```powershell
npm run security:audit
```

Expected residual until Next bumps bundled postcss: 1 moderate (GHSA-qx2v-qp2m-jg93). See `docs/security-register.md` for the mitigation rationale. The registry TLS chain validates against the Windows root store via the `--use-system-ca` flag baked into the script; the `NODE_OPTIONS=--use-system-ca` env var also remains persisted at user scope on the maintainer's machine as a fallback and for `npm install`. See `docs/security-register.md` for background and the `NODE_EXTRA_CA_CERTS` alternative.
