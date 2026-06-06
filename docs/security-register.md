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
| Change | Phase 3 Lexical FTS introduces the project's first `$queryRaw` in the search layer: `searchKeyword` in `lib/search.ts` now builds a parameterized PostgreSQL FTS query using `websearch_to_tsquery('bible_simple', …)`. |
| Reason | The ILIKE `text: { contains }` path Prisma previously used was replaced by a raw query to enable `tsvector @@ tsquery` matching against the stored generated column. Prisma does not yet expose a first-class FTS API for generated columns. |
| Status | Mitigated |
| Mitigation | All user- and assistant-supplied values (query string, corpus, book, chapter, pagination offsets) are bound as Prisma.sql tagged template parameters or via `Prisma.join` — no string interpolation of user input into the SQL string. `websearch_to_tsquery` is documented to tolerate arbitrary/hostile input (including unbalanced quotes and special operators) without throwing or producing injection risk. Code reviewed at PR merge. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-30 (Phase 3 Lexical FTS) |
| Next review | Re-check if the raw query in `searchKeyword` is extended with new parameters. |

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

## Tooling notes

- `npm audit` requires network access to the npm registry. If the
  registry call fails with `unable to verify the first certificate`,
  that is a local TLS trust-store issue (corporate root CA, MITM
  proxy, AV HTTPS scanning, or similar), not an advisory.
- **Resolved on the maintainer's Windows machine (2026-05-26):** Norton
  AV's "Web/Mail Shield" intercepts the registry TLS and re-signs with
  a root that lives in the Windows certificate store. Node 22+ does
  not consult the Windows store by default. Fix: set the user-level
  env var `NODE_OPTIONS=--use-system-ca` (e.g. via
  `setx NODE_OPTIONS "--use-system-ca"`), then re-open the shell.
  Node will then trust the Windows store in addition to its bundled
  CAs and `npm audit` succeeds.
- Alternative if `--use-system-ca` is unavailable or undesired: export
  the intercepting root to a `.pem` file and set
  `NODE_EXTRA_CA_CERTS=<path-to-that-pem>`.
- Fallback: run audits from CI or any machine with clean registry
  access before declaring the gate met.
- `npm run db:push` is intentionally disabled. This project depends on
  handwritten SQL migrations for `bible_simple`, generated `tsvector`,
  `pgvector`, HNSW, and embedding `textHash`; use
  `npm run db:migrate:deploy` to apply the checked-in migrations.

## Closed

_None yet._
