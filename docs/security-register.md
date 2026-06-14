# Security Register

Tracks known security advisories, exceptions, and outstanding hardening
debt. Update whenever an advisory is accepted, mitigated, or closed.

Review cadence: re-run `npm audit --audit-level=low` at the start of every
sprint and at every Next.js minor upgrade. Cross-check each open row.

## Open

### GHSA-qx2v-qp2m-jg93 — postcss XSS via unescaped `</style>`

| Field | Value |
| --- | --- |
| Severity | Moderate (CVSS 6.1) |
| Advisory | https://github.com/advisories/GHSA-qx2v-qp2m-jg93 (CVE-2026-41305) — "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output" |
| Affected package | `postcss <8.5.10`, bundled transitively under `next` (the repo's own direct `postcss@^8.5.3` is also below the fix) |
| Direct dependency that pulls it in | `next` |
| First fixed version | `postcss@8.5.10`. Verified against `npm audit --json` on 2026-05-31 (range `<8.5.10`); earlier rows here mis-titled this as "line return parsing" with an `8.4.32` fix — that was a different/older advisory and is corrected here. |
| Status | Accepted exception — upstream-blocked |
| Mitigation | We do not feed untrusted PostCSS source to any build step. PostCSS only runs at build time over our own `app/globals.css` and Tailwind output. No user-controlled CSS reaches it. |
| Path to resolve | Wait for a Next.js release that bundles a newer PostCSS, then upgrade Next and re-run `npm audit`. Do **not** run `npm audit fix --force` — it proposes a breaking Next downgrade. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-25 (Sprint 3) |
| Next review | Re-check after each Next.js minor release. |

### Generated-study-notes request body limit raised to 256 KB

| Field | Value |
| --- | --- |
| Severity | Low (request-size / DoS-surface consideration) |
| Change | `POST /api/generated-study-notes` caps raised: `NOTE_BODY_LIMIT` 64 KB → 256 KB, `MAX_ANSWER` 10 KB → 64 KB, `MAX_MARKDOWN` 12 KB → 72 KB (`app/api/generated-study-notes/route.ts`). |
| Reason | The retrieval-scoping change returns whole passages in full, so a deterministic-fallback answer overflowed the old caps and 400'd on save. A single chapter is ~13 KB; the true worst case is a multi-reference prompt at the planner's 8-passage-call ceiling (4 large chapters × 2 corpora), measured on the full corpus at ~57 KB answer / ~58 KB markdown / ~167 KB request body. Caps sized to that ceiling with margin. |
| Status | Accepted — bounded |
| Mitigation | Endpoint is behind auth (`requireAuth`) and same-origin (`assertSameOrigin`); `readJsonLimited` still rejects bodies over the 256 KB cap with 413. The upstream answer/markdown sizes are hard-bounded by `MAX_PLANNED_CALLS` (8) × `MAX_PASSAGE_LINES`, so payloads cannot grow unboundedly — a 6-reference prompt produces the same size as a 4-reference one. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-30 (retrieval-scoping branch) |

### OpenAI client request timeout raised to 120 s

| Field | Value |
| --- | --- |
| Severity | Low (resource-holding / DoS-surface consideration) |
| Change | Default OpenAI client `timeout` raised 25 s → 120 s in `lib/ai/openaiClient.ts` (override via `OPENAI_REQUEST_TIMEOUT_MS`); `maxRetries: 1` unchanged. |
| Reason | A full grounded answer (~`OPENAI_MAX_OUTPUT_TOKENS`=2400 of structured JSON with Greek) routinely takes longer than 25 s to generate, so the client abandoned responses the model had already completed server-side and surfaced "Request timed out" → the local fallback. |
| Status | Accepted — bounded |
| Mitigation | The only caller (`POST /api/assistant`) is behind auth (`requireAuth`), same-origin (`assertSameOrigin`), and per-user/IP rate-limited (`rateLimitKey` scope `assistant`). A live request can now hold a worker up to ~120 s (≤ ~240 s across the single retry); concurrency is bounded by the rate limiter, not unbounded. On serverless hosts, function `maxDuration` must be ≥ this timeout or the platform terminates the request first. |
| Path to resolve | Stream the response so partial output is consumed as it arrives instead of an all-or-nothing wait, allowing a shorter hard timeout. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-31 (assistant timeout/grounding fix) |

### Phase 4a OpenAI embeddings endpoint (`text-embedding-3-small`)

| Field | Value |
| --- | --- |
| Severity | Low (data-egress consideration) |
| Change | Phase 4a sends query text (at search time) and WEB verse text (at ingest/backfill time) to OpenAI's embeddings API (`text-embedding-3-small`) via the existing `lib/ai/openaiClient.ts` shared client. |
| Trust boundary | Same as the existing synthesis calls — OpenAI is already a trusted sub-processor. No new vendor or secret is introduced; the existing `OPENAI_API_KEY` is reused. |
| Data sensitivity | WEB verse text is public domain. Query text is the same user prompt already sent to the synthesis model; no new user data category is exposed to OpenAI. |
| Status | Accepted — same trust boundary as synthesis |
| Mitigation | `embed:verses` ingestion is an offline script run by the maintainer, not a per-request server path. It is idempotent and re-embeds only when a row is missing, the stored model differs, or the stored WEB text hash differs. The search-time embedding call (`embedQuery`) sends only the user's assistant prompt, already covered by the existing synthesis data-handling posture. `searchSemantic` filters `VerseEmbedding.model` to the current embedding model so stale model rows are not mixed into retrieval. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-02 (Phase 4a vector + hybrid retrieval) |

### Phase 3 raw SQL surface in searchKeyword (`lib/search.ts`)

| Field | Value |
| --- | --- |
| Severity | Low (SQL injection surface — mitigated) |
| Change | Phase 3 Lexical FTS introduced the project's first `$queryRaw` in the search layer: `searchKeyword` in `lib/search.ts` builds a parameterized PostgreSQL FTS query. **Extended 2026-06-13 (English keyword stemming):** `searchKeyword` now binds *two* configs in a single language-routed predicate — `websearch_to_tsquery('bible_english', …)` against `textSearchEn` for English (WEB) rows and `websearch_to_tsquery('bible_simple', …)` against `textSearch` for Greek rows — plus a per-row `ts_headline(<config>, "text", <tsquery>, <options>)` for stem-aware highlighting. The assistant's `searchSemantic` keyword FTS leg likewise switched its raw query to `websearch_to_tsquery('bible_english', …)` / `textSearchEn` (WEB-only, no routing). |
| Reason | The ILIKE `text: { contains }` path Prisma previously used was replaced by a raw query to enable `tsvector @@ tsquery` matching against the stored generated column. Prisma does not yet expose a first-class FTS API for generated columns. The 2026-06-13 extension adds the second (`bible_english`) config/column and `ts_headline` to stem English keyword search without disturbing the Greek path. |
| Status | Mitigated |
| Mitigation | All user- and assistant-supplied values (query string, corpus, book, chapter, pagination offsets) remain bound as Prisma.sql tagged template parameters or via `Prisma.join` — no string interpolation of user input into the SQL string. The added `bible_english`/`bible_simple` config names and the `ts_headline` options string (the U+E000/U+E001 sentinels in `HEADLINE_OPTIONS`) are developer-controlled literals, not user-derived. `websearch_to_tsquery` is documented to tolerate arbitrary/hostile input (including unbalanced quotes and special operators) without throwing or producing injection risk, for both configs. Code reviewed at PR merge. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-30 (Phase 3 Lexical FTS); extended 2026-06-13 (English keyword stemming); extended 2026-06-13 (kept-stopword follow-up) |
| Next review | Re-check if the raw query in `searchKeyword` or the `searchSemantic` FTS leg is extended with new parameters or a new config/column. |

**Kept-stopword follow-up (2026-06-13):** Migration `20260613130000_english_stem_no_stopwords` replaced the `english_stem` dictionary in `bible_english` with a custom Snowball dictionary `english_stem_nostop` (no stopword list) and rebuilt `Verse.textSearchEn` + its GIN index. The `bible_english` config still maps through `unaccent` + `english_stem_nostop` and remains **IMMUTABLE**; all user-supplied values are still bound as `Prisma.sql` parameters. No new extension, no new egress path, and no new injection surface — `websearch_to_tsquery('bible_english', …)` tolerates arbitrary input for the custom dictionary exactly as it did for the built-in `english_stem`.

### Phase 4b rerank — Vercel AI Gateway / Voyage data flow (accepted)

- **Outbound host:** `ai-gateway.vercel.sh`, called **server-side (Node) only** from
  `lib/search/rerank.ts`. No browser fetch, so the CSP `connect-src` (which already omits
  `api.openai.com` for the same reason) needs **no change**. Recorded as a reasoned decision, not an
  omission.
- **New processors / trust boundary:** Vercel AI Gateway (proxy) and Voyage AI (rerank provider).
  The Voyage API key is held in AI Gateway settings (BYOK) or Vercel billing — **never** in the app
  `.env`; the app holds only `AI_GATEWAY_API_KEY`.
- **Data sent:** the user prompt + WEB verse text for the candidate pool. WEB is public-domain
  scripture and the prompt is already sent to OpenAI for synthesis — no new *class* of data, but it
  now reaches two additional processors.
- **Gating:** rerank is gated on `AI_GATEWAY_API_KEY`. With the key unset, the wrapper returns
  `null` before any network call — **nothing is sent**.
- **Zero Data Retention:** per the Vercel model page, **ZDR is NOT currently available for
  `voyage/rerank-2.5`** (ZDR is offered per-provider; this model is not covered). Prompts + WEB text
  sent for reranking may therefore be retained under Voyage's standard policy. **Accepted** given the
  low-sensitivity, public-domain data and the opt-in gating. If a ZDR guarantee is later required,
  switch to a ZDR-supporting rerank model/provider or disable rerank. Re-check the model page on AI
  SDK/Gateway upgrades.
- **Status: accepted.**

### Phase 5a — UBS Louw-Nida dataset (CC-BY-SA 4.0 licensing obligation)

| Field | Value |
| --- | --- |
| Severity | Licensing / distribution obligation (not a security vulnerability) |
| Change | Phase 5a vendors `data/louw-nida/UBSGreekNTDicLexicalDomains-v1.1-en.JSON` (738 domain/subdomain nodes) from the UBS open-license repository (`ubsicap/ubs-open-license`). |
| License | **Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA 4.0)** |
| Attribution | Full attribution and NOTICE in `data/louw-nida/NOTICE.md`; one-line credit in `README.md` (Open Text Imports section). |
| ShareAlike obligation | Any redistribution of the data file or an adapted database derived from it must be released under CC-BY-SA 4.0 (or a compatible license) with attribution preserved. The obligation is on the *data*: running the import script over a private database does not trigger redistribution; publishing a derived domain-label dataset would. |
| Status | Accepted — obligation documented |
| Mitigation | Attribution is in `data/louw-nida/NOTICE.md` and `README.md`. The data is only loaded into the app database at import time; the raw JSON is not served to end users. Review before any public data export or dataset redistribution. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-06 (Phase 5a Louw-Nida enrichment) |
| Next review | Re-check if the vendored JSON is updated or if domain labels are exported as a derived dataset. |

### Phase 6 — eval CI secrets (GitHub Actions)

| Field | Value |
| --- | --- |
| Severity | Low (secret-management / data-egress consideration) |
| Change | Two GitHub Actions workflows (`.github/workflows/eval-gate.yml`, `weekly-eval-report.yml`) consume repo secrets: `EVAL_DATABASE_URL` + `EVAL_DIRECT_URL` (both workflows), and `OPENAI_API_KEY` + `AI_GATEWAY_API_KEY` (weekly report only). |
| Trust boundary | No new processors. The DB is the existing **seeded Neon test branch** (never production); OpenAI and the Vercel AI Gateway/Voyage are already trusted sub-processors (see the Phase 4a/4b rows). The eval reuses the same keys, no new vendor. |
| Data sensitivity | The gate is deterministic and DB-only — no egress. The weekly report sends the fixed golden-set prompts + WEB verse text (public domain) to OpenAI/the Gateway — same data class already covered by the synthesis and rerank rows. |
| Status | Accepted — same trust boundary as synthesis/rerank |
| Mitigation | Secrets are injected via the job `env:` block over an empty `.env.test`, so no secret material is written to the runner disk. Both workflows declare least-privilege `permissions: contents: read` (no commit/PR scope). The `EVAL_*` DB secrets are named distinctly to prevent pointing CI at production; the gate is read-only (no DB writes). GitHub masks secret values in logs. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-08 (Phase 6 CI workflows) |
| Next review | Re-check if a workflow gains write scope, a new secret, or is pointed at a non-test database. |

### Non-atomic in-use column rebuild — migration `20260613130000_english_stem_no_stopwords`

| Field | Value |
| --- | --- |
| Severity | Low (deploy-time availability — brief, one-time) |
| Change | The migration rebuilds the **in-use** STORED generated column `Verse.textSearchEn` via `DROP COLUMN` + re-`ADD COLUMN` (so existing rows recompute under the new `english_stem_nostop` mapping; changing the text-search config does not recompute a stored column). The file's comment claims it "runs in one transaction," but there is **no** explicit `BEGIN;`/`COMMIT;`. |
| Correction | That comment is **wrong**. Prisma Migrate does **not** wrap PostgreSQL migrations in a transaction by default — atomicity is opt-in via explicit `BEGIN;`/`COMMIT;` (kept off so statements like `CREATE INDEX CONCURRENTLY` remain possible). Sources: [Prisma limitations](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues), [prisma/prisma#8080](https://github.com/prisma/prisma/issues/8080), [discussion #3774](https://github.com/prisma/prisma/discussions/3774). So the drop/re-add was **not** atomic. |
| Risk | App code queries `textSearchEn` in both the keyword and semantic paths (`lib/search.ts`). Applied to a live database under traffic, a concurrent query in the sub-second window between `DROP COLUMN` and re-`ADD COLUMN` could fail with `column "textSearchEn" does not exist`. |
| Status | **Accepted — one-time, already applied** |
| Mitigation | The migration already applied cleanly to both Neon branches (dev/prod `ep-tiny-queen` + test/eval `ep-restless-union`) with no observed search errors; the window has passed and the column is present and correct. The migration file **cannot** be corrected in place — editing an applied migration's bytes trips Prisma's checksum-drift guard — so the misleading in-file comment is superseded by this entry. |
| Convention (forward) | Any **future** drop/re-add of an in-use column that live search queries (`textSearch` / `textSearchEn` / embedding columns) **must** bracket the statements in explicit `BEGIN;` … `COMMIT;`, so concurrent reads block on the `ACCESS EXCLUSIVE` lock rather than hit a momentarily-missing column. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-14 (kept-stopword PR review — Codex P2) |

## Tooling notes

- `npm audit` requires network access to the npm registry. If the
  registry call fails with `unable to verify the first certificate`,
  that is a local TLS trust-store issue (corporate root CA, MITM
  proxy, AV HTTPS scanning, or similar), not an advisory.
- **Resolved on the maintainer's Windows machine (2026-05-26):** Norton
  AV's "Web/Mail Shield" intercepts the registry TLS and re-signs with
  a root that lives in the Windows certificate store. Node 22+ does
  not consult the Windows store by default. Fix: Node's
  `--use-system-ca` flag, which trusts the Windows store in addition to
  its bundled CAs.
- **Hardened to not depend on the env var (2026-06-09):** every
  Node-spawning npm script now bakes in `--use-system-ca` via `cross-env`
  (chained scripts use `cross-env-shell` so the flag reaches every
  command in the chain). `npm run security:audit`, `build`, the
  `import:*`/`embed:*`/`eval:*`/`db:*` tasks, and the integration/
  acceptance tests therefore succeed in any shell, even a freshly opened
  terminal that never inherited `NODE_OPTIONS`. Rationale: env-var
  inheritance is fragile — a process only sees `NODE_OPTIONS` if it was
  launched *after* `setx` set it, so editors/terminals opened earlier
  silently run without it. Baking the flag into the scripts removes that
  failure mode for everything except `npm install` itself.
- **Node floor — requires Node ≥ 22.15 (2026-06-09):** `--use-system-ca`
  was added in Node 22.15 / 24; older Node rejects it in `NODE_OPTIONS`
  with `node: --use-system-ca is not allowed in NODE_OPTIONS` (exit 9).
  Because the flag now lives in shared scripts that CI also runs, the
  CI Node had to support it: the eval-gate and weekly-report workflows
  were bumped from Node 20 → 24 (matching local dev), and `engines.node`
  + `.nvmrc` pin the floor so the drift can't recur. Caught by Codex as
  a P1 on PR #15 — the original Node-20 gate run failed at `npm ci`
  postinstall.
- **`npm install`/`npm ci` cannot be self-armed:** the dependency
  download runs before any package.json script (postinstall included),
  so the flag must already be in the environment. Use
  `NODE_OPTIONS=--use-system-ca npm install` ad-hoc, or persist it at
  user scope via `setx NODE_OPTIONS "--use-system-ca"` (then fully
  restart the shell/editor so it inherits the value).
- The user-level `NODE_OPTIONS=--use-system-ca` env var remains set on
  the maintainer's machine as a belt-and-suspenders default and to cover
  the install step.
- **IDE test-runner failure mode — Cursor/VS Code blanks `NODE_OPTIONS`
  (root-caused 2026-06-13):** the live `rerankCandidates` integration test
  (`tests/integration/semantic-search.test.ts`, gated only on
  `AI_GATEWAY_API_KEY`) fails with the misleading message *"rerank returned
  null — gateway/key/model misconfigured"* whenever vitest runs **without**
  `--use-system-ca`. The reranker swallows the underlying
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE` TLS error in its `catch` (returns null),
  so the symptom hides the real cause. It passes via `npm run test:integration`
  (which bakes the flag in via `cross-env`) but fails from any path that
  bypasses that script — the Vitest extension or the editor's integrated
  terminal. Root cause is environmental, not code, and is **not** a stale
  process-tree block (an earlier hypothesis): even after a full reboot, with
  the user-scope value correctly present in `explorer.exe` (verified by
  reading the process's PEB environment block: `explorer` =
  `NODE_OPTIONS=--use-system-ca`), **Cursor itself empties `NODE_OPTIONS` for
  every process it spawns** (the Cursor main process shows `NODE_OPTIONS=`
  blank; its children drop it entirely). This is inherited Electron/VS Code
  behaviour — the editor deliberately clears `NODE_OPTIONS` so loader/debug
  flags don't leak into the many Node subprocesses it launches (extension
  host, language servers, terminal, Claude Code). Therefore **no OS-level env
  var (`setx`, user-scope `NODE_OPTIONS`) can reach an IDE-launched run** —
  the flag must be **re-injected after Cursor strips it**. Working fixes:
  (1) run via `npm run test:integration` — `cross-env` re-sets the flag for
  that command regardless of Cursor (canonical, works today); (2) for the
  integrated terminal, add to Cursor `settings.json`:
  `"terminal.integrated.env.windows": { "NODE_OPTIONS": "--use-system-ca" }`
  (verified: bare `vitest` then passes); (3) for the Vitest extension, set
  `"vitest.nodeExecArgs": ["--use-system-ca"]`. Note: `pool: "forks"` +
  `poolOptions.forks.execArgv: ["--use-system-ca"]` in the vitest config does
  **not** work — vitest v4 does not honor the flag through `execArgv`;
  `NODE_OPTIONS` in the spawning environment is the only reliable mechanism.
- **Accepted assumption — scripts OVERWRITE `NODE_OPTIONS` (Codex P2, PR
  #15):** the `cross-env NODE_OPTIONS=--use-system-ca` prefix replaces any
  inherited `NODE_OPTIONS` rather than appending to it. Verified safe for
  this repo: nothing in `.github/`, `next.config`, or Vercel sets
  `NODE_OPTIONS` for another purpose, the maintainer's user-scope value is
  already `--use-system-ca` (identical → no-op overwrite), and CI leaves it
  unset. So no `--max-old-space-size` / `--require` (memory/instrumentation)
  options are being dropped. **Hardening debt:** if a conflicting
  `NODE_OPTIONS` is ever introduced (e.g. a build-memory flag in CI),
  switch from `cross-env` to a small wrapper that *appends* `--use-system-ca`
  to the existing value instead of overwriting.
- Alternative if `--use-system-ca` is unavailable or undesired: export
  the intercepting root to a `.pem` file and set
  `NODE_EXTRA_CA_CERTS=<path-to-that-pem>`.
- Fallback: run audits from CI or any machine with clean registry
  access before declaring the gate met.
- `npm run db:push` is intentionally disabled. This project depends on
  handwritten SQL migrations for `bible_simple`, generated `tsvector`,
  `pgvector`, HNSW, and embedding `textHash`; use
  `npm run db:migrate:deploy` to apply the checked-in migrations.
- **In-use column rebuilds must be transaction-wrapped.** Prisma does not wrap
  PostgreSQL migrations in a transaction by default, so any future `DROP COLUMN` +
  re-`ADD COLUMN` on a column live search queries (`textSearch` / `textSearchEn` /
  embeddings) must bracket the statements in explicit `BEGIN;` … `COMMIT;`. See the
  accepted-risk advisory **"Non-atomic in-use column rebuild"** in the Open section
  for the rationale and the one-time exception (migration `…english_stem_no_stopwords`).

## Closed

_None yet._
