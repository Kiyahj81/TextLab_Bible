# TextLab Bible Security And Testing Remediation Plan

Status: Proposed Phase 3.0 hardening plan
Date: 2026-05-25
Scope: Security and test hardening required before public exposure, beta access, or external testing.

This document integrates the local Codex audit and the Copilot audit report into one implementation-ready remediation plan. It is written for an LLM coding assistant that will implement the work in the existing Next.js App Router, Prisma, PostgreSQL, and Vitest codebase.

## Executive Summary

The project is a single full-stack Next.js App Router application with Prisma/PostgreSQL as the data boundary. The highest-risk gaps are not SQL injection or obvious XSS patterns; the code avoids raw Prisma SQL, `dangerouslySetInnerHTML`, and `eval`. The concrete risks are production-readiness gaps around identity, request abuse, validation, browser security headers, and test coverage.

Current verified state from the audit:

- `npm run lint` passed.
- `npx tsc --noEmit --pretty false` passed.
- `npm run test:unit` passed: 84 tests across 17 files.
- `npm run test:unit -- --coverage` passed and reported 80% line coverage, 78.08% statements, 64.56% branches, and 71.96% functions.
- `npm run build` passed.
- `Test-NetConnection localhost -Port 5433` passed after Docker/PostgreSQL was started.
- `npm run test:acceptance` passed after Docker/PostgreSQL was running. The suite completed the reader, morphology popover, highlight, note, lemma search, saved search, assistant, generated note, Markdown export, notes API, and mobile no-overflow checks.
- `npm audit --audit-level=low` reports two moderate advisories from Next's bundled `postcss@8.4.31` for GHSA-qx2v-qp2m-jg93. Do not run `npm audit fix --force`; it proposes a breaking downgrade path.

## Severity Findings

### High

1. No real authentication or authorization

   `lib/user.ts` hardcodes `local-user`. User-scoped APIs and pages all rely on that shared id. If the app is exposed beyond localhost, any visitor can read, create, update, or delete the single local user's notes, highlights, saved searches, generated study notes, and assistant sessions.

   Affected areas:

   - `lib/user.ts`
   - `app/api/notes/*`
   - `app/api/highlights/route.ts`
   - `app/api/saved-searches/*`
   - `app/api/generated-study-notes/route.ts`
   - `app/api/assistant/route.ts`
   - `app/read/page.tsx`
   - `app/search/page.tsx`
   - `app/notes/page.tsx`
   - `app/assistant/page.tsx`

2. Uncapped assistant usage can amplify OpenAI cost

   `POST /api/assistant` accepts any prompt and, when `OPENAI_API_KEY` is set and live mode is enabled, can trigger OpenAI calls. It has no authentication, no rate limit, and no prompt length cap. A script can burn budget and degrade availability.

### Medium

1. Reader data will leak across users after auth unless includes are user-scoped

   `getReaderPassage` includes token/verse `notes` and `highlights` without filtering by user id. This is acceptable only under the current single-user stub. Once real users exist, the reader must load only the active user's notes/highlights.

2. Request validation is ad hoc

   Routes parse JSON directly and validate fields inline. Free-text fields have no shared max-length policy. `POST /api/highlights` accepts any string as `color`, even though the client has a palette allowlist.

3. No explicit body-size strategy for App Router route handlers

   The Copilot report recommended Pages Router `bodyParser.sizeLimit` style config. This app uses App Router route handlers, so implement a shared limited JSON reader instead of relying on Pages Router config.

4. No CSRF-style origin protection for cookie-based auth

   Today JSON content-type is an implicit barrier. Once Auth.js cookie sessions are introduced, mutation routes should reject cross-origin writes with a same-origin `Origin`/`Host` check.

5. No HTTP security headers

   `next.config.ts` has no headers block. Production responses should include standard browser hardening headers.

6. Moderate dependency advisory remains

   Next's bundled PostCSS advisory is upstream-blocked. Track it in a security register with a known-exception rationale until a safe Next update is available.

### Low

1. `.env.example` is ignored while README tells developers to copy it.

   Stop ignoring `.env.example` and track a sanitized example.

2. Acceptance test depends on PostgreSQL but does not preflight it.

   The acceptance suite passes when Docker/PostgreSQL is running on `localhost:5433`, but if the database is down it waits for `/read` and fails as a generic Next readiness error. It should fail early with an actionable database message.

3. Coverage threshold is not configured.

   Coverage can be measured manually, but it is not an enforced gate.

## Remediation Sprints

### Sprint 1: Stop The Bleeding

Goal: Reduce the easiest abuse paths before full auth lands.

Tasks:

- Add a prompt length cap and a max-output-tokens cap to `POST /api/assistant`.
  - Input cap: 2,000 characters; return `400` with a stable JSON error if exceeded.
  - Output cap: pass `max_tokens` (or model-equivalent) to the OpenAI call to bound response size. `OPENAI_REQUEST_TIMEOUT_MS=25000` exists today and is a partial mitigation only; the token cap closes the other half of the cost-amplification loop.
- Add an in-memory token-bucket rate limiter for `POST /api/assistant`.
  - Bucket key: authenticated user id when available; otherwise the platform-provided client IP. Trust only the host-specific header (`x-vercel-forwarded-for` on Vercel, `cf-connecting-ip` on Cloudflare). Never trust raw `x-forwarded-for` directly — it is trivially spoofable.
  - Default burst: 10 requests per minute.
  - Return `429` with `Retry-After`.
  - **Caveat (read carefully):** an in-memory bucket is silently a no-op on serverless platforms where every invocation can be a fresh process. Label the helper as **single-VM / localhost only** and skip it (or short-circuit to "always allow") when the deployment env indicates serverless. Before public exposure on a serverless host, replace it with Upstash / Vercel KV / Cloudflare KV. Do not ship the in-memory limiter as a production control on serverless.
- Add server-side highlight color validation.
  - Reuse the same palette values from `lib/highlight.ts` or move the allowlist to a server-safe shared module.
  - Reject invalid colors with `400`; do not silently coerce arbitrary values.
- Add shared request helpers.
  - `readJsonLimited(request, maxBytes)` for App Router route handlers.
  - Default max mutation body size: 16 KB.
  - `jsonError(message, status)` for stable error responses.
  - Safe malformed JSON handling with `400`.
- Add schema validation.
  - Use `zod` or a similarly explicit schema layer.
  - Validate all mutation route bodies before Prisma writes.
- Add a stub `requireUserId()` in this sprint (not Sprint 2).
  - Returns `localUserId` today; Sprint 2 swaps the implementation for a real session lookup.
  - Lets Sprint 1 validation/limiter code be written against the final contract, so handlers are not rewritten twice.

Acceptance criteria:

- Invalid assistant prompt length returns `400`.
- Assistant responses are bounded by an output token cap.
- Assistant bursts return `429` with `Retry-After` on a single-VM run.
- Invalid highlight colors return `400`.
- Malformed or oversized JSON does not reach Prisma writes.

### Sprint 2: Authentication And Authorization

Goal: Replace the hardcoded local user with real session-based identity.

Tasks:

- Add Auth.js v5 with Prisma adapter.
  - Pin **Auth.js v5** explicitly: `@auth/core`, `@auth/prisma-adapter`, and `next-auth@beta` (the v5 wrapper). The v4 → v5 API differs significantly, and the Prisma adapter expects the v5 model shape.
  - Add root `auth.ts`.
  - Add `app/api/auth/[...nextauth]/route.ts`.
  - Use GitHub OAuth for production if credentials are available.
  - Provide a test/dev-only provider only when an explicit env flag is enabled.
  - Require `AUTH_SECRET`.
- Add Auth.js Prisma models and migration in this strict order (FKs cannot precede the seed row):
  1. Add a `User` model and run a migration that creates the table.
  2. Seed one row with `id = "local-user"` so existing rows keep referential integrity.
  3. Add `Account`, `Session`, `VerificationToken`, and any fields required by the installed Auth.js Prisma adapter.
  4. Add FK relations from existing user-owned models (`Highlight`, `Note`, `SavedSearch`, `GeneratedStudyNote`, `AiSession`) to `User.id` in a follow-up migration.
  5. `prisma/schema.prisma` has **no** `User` model today — verified. This is a from-scratch add, not an edit.
- Replace runtime use of `localUserId`.
  - Swap the Sprint 1 stub `requireUserId()` for a real session-based implementation.
  - Add `getOptionalUserId()` only where anonymous reads are intentionally allowed.
  - Remove the hardcoded local identity from runtime paths.
- Protect API routes and pages.
  - Handler-level checks are mandatory.
  - Middleware may be added for route-level redirects, but it must not be the only enforcement layer.
  - Protected API routes return `401 { "error": "Unauthenticated." }`.
  - Protected pages redirect to sign-in.
- Enforce ownership.
  - All read/update/delete operations on user-owned data must filter by active `userId`.
  - `AiSession` lookup by `sessionId` must remain scoped to the active user.
  - Generated notes, saved searches, notes, and highlights must never be retrievable across users.
- Scope reader data includes.
  - Pass `userId` into `getReaderPassage`.
  - Filter included notes/highlights by active `userId`.

Acceptance criteria:

- No runtime code relies on a hardcoded `local-user`.
- Unauthenticated API calls return `401`.
- User A cannot read, update, delete, or render user B's user-owned data.
- Existing local data is preserved under a migration-safe user row.

### Sprint 3: HTTP And Deployment Hardening

Goal: Add browser, origin, env, and dependency controls needed for public exposure.

Tasks:

- Add same-origin mutation protection.
  - For `POST`, `PATCH`, and `DELETE`, require a valid same-origin `Origin` or trusted fallback policy for non-browser clients.
  - Compare against `Host` or configured `APP_URL`.
  - Return `403` on mismatch.
- Configure Auth.js cookie behavior.
  - Use secure cookies in production.
  - Prefer strict or lax same-site behavior appropriate for the selected provider flow.
  - Document any provider constraints.
- Add security headers in `next.config.ts`.
  - `Content-Security-Policy` — drop `https://api.openai.com` from `connect-src` (OpenAI is called server-side from `lib/ai/assistant.ts`, never from the browser). Drop `unsafe-eval` from the production CSP; Next 14+ App Router does not need it in production builds. Inline-style allowance is the realistic concession; aim for `'strict-dynamic'` + nonces for scripts where feasible.
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` — include `payment=()`, `usb=()`, `interest-cohort=()` in addition to camera/microphone/geolocation.
  - `Strict-Transport-Security` in production only.
  - Include `frame-ancestors 'none'` in CSP.
- Add a security register.
  - Record the Next/PostCSS moderate advisory.
  - Include advisory URL, affected package path, current mitigation, owner, and review cadence.
  - Re-check after Next releases.
- Fix environment documentation.
  - Track sanitized `.env.example`.
  - Include `DATABASE_URL`, `AUTH_SECRET`, provider placeholders, OpenAI settings, assistant live-disable flag, and test-auth flag.
  - Keep `.env` and `.env.local` ignored.

Acceptance criteria:

- Mutation routes reject cross-origin writes.
- Required headers are present in a live Next response.
- HSTS is enabled only for production HTTPS deployment.
- Dependency exception is documented and auditable.
- Setup docs match the tracked env example.

### Sprint 4: Test Coverage And CI Gates

Goal: Make the hardening measurable and keep it from regressing.

Tasks:

- Configure coverage.
  - Use Vitest coverage provider `v8`.
  - Enforce at least 80% line coverage after new tests land.
  - **Enable the coverage gate in the LAST PR of Sprint 4, not the first.** Current baseline is 80% lines / 64% branches, so security code added without tests will push lines below the threshold mid-sprint and block merges. The first PRs should add tests; the gate flips on after.
  - Consider later thresholds for branches and functions after the initial security sprint.
- Add auth route tests.
  - Missing session returns `401`.
  - Authenticated requests succeed.
  - User A cannot access user B records.
  - Session helper behavior is covered.
- Add assistant abuse tests.
  - Prompt length rejection.
  - Rate-limit burst rejection.
  - `Retry-After` header.
  - Bucket reset behavior.
  - Missing API key still falls back without live OpenAI calls.
- Add validation tests.
  - Malformed JSON returns `400`.
  - Oversized JSON returns `413` or documented equivalent.
  - Invalid highlight color returns `400`.
  - Invalid negative `englishWordIndex` returns `400`.
  - Overlong note body/title, saved search label, generated note markdown, tags, and citations are rejected.
- Add missing route tests.
  - `app/api/generated-study-notes/route.ts`: GET, POST, validation errors, Prisma errors, user scoping.
  - `app/api/import-runs/route.ts`: GET, Prisma error handling, auth behavior.
- Add DB integration tests.
  - Exercise real Prisma queries against an isolated test database.
  - Cover ownership constraints for notes/highlights/saved searches.
  - Cover migration assumptions and foreign key behavior.
- Improve acceptance testing.
  - Add a PostgreSQL preflight before starting Next.
  - Fail with a clear message if `DATABASE_URL` is unreachable.
  - Run the acceptance path under test auth.
  - Keep Playwright acceptance as a separate CI gate rather than trying to fold it into unit-test coverage.
- Add security header integration tests.
  - Start a real Next server or use the existing acceptance harness.
  - Verify required headers on a page response and an API response.
- Add a sign-out + session-revocation test.
  - After a session is signed out, a request reusing the previous session cookie must return `401`.
  - Covers the "old session after sign-out" case that the basic "missing session" test does not.
- Add an assistant-output rendering safety test.
  - Confirm assistant responses are rendered as text/Markdown, not raw HTML, on whichever page surfaces them. Cheap insurance against prompt-injection of HTML/JS into the UI.

Acceptance criteria:

- Coverage gate passes.
- Auth, rate limit, validation, headers, and DB ownership tests pass.
- Acceptance test either passes or fails early with a database preflight error.

## Implementation Details

### Suggested New Or Updated Files

Likely new files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `lib/auth.ts`
- `lib/http/security.ts`
- `lib/http/validation.ts`
- `lib/rate-limit.ts`
- `lib/security/headers.ts` or inline `next.config.ts` headers helper
- `docs/security-register.md`
- `tests/unit/api/generated-study-notes.test.ts`
- `tests/unit/api/import-runs.test.ts`
- `tests/unit/lib/auth.test.ts`
- `tests/unit/lib/rate-limit.test.ts`
- `tests/integration/security-headers.test.ts`
- `tests/integration/db-ownership.test.ts`

Likely updated files:

- `package.json`
- `package-lock.json`
- `prisma/schema.prisma`
- `prisma/migrations/*`
- `.gitignore`
- `.env.example`
- `README.md`
- `next.config.ts`
- `vitest.config.ts`
- `scripts/acceptance-test.js`
- `lib/user.ts` or remove it after migration
- `lib/search.ts`
- `app/read/page.tsx`
- `app/search/page.tsx`
- `app/notes/page.tsx`
- `app/assistant/page.tsx`
- `app/api/assistant/route.ts`
- `app/api/notes/route.ts`
- `app/api/notes/[id]/route.ts`
- `app/api/highlights/route.ts`
- `app/api/saved-searches/route.ts`
- `app/api/saved-searches/[id]/route.ts`
- `app/api/generated-study-notes/route.ts`
- `app/api/import-runs/route.ts`

### Validation Defaults

Use these limits unless implementation discovers a better local convention:

- JSON body size: 16 KB for mutation routes.
- Assistant prompt: 2,000 characters.
- Note body: 10,000 characters.
- Note title: 200 characters.
- Saved search label: 100 characters.
- Saved search query: 500 characters.
- Saved search corpus/book: 100 characters.
- Generated note prompt: 2,000 characters.
- Generated note answer: 10,000 characters.
- Generated note markdown: 12,000 characters.
- Tags: max 20 tags, max 32 characters each.
- Citations: max 50 entries.
- `englishWordIndex`: integer >= 0.
- Highlight color: exact allowlist match only.

### Error Response Contract

Use stable JSON errors:

```json
{ "error": "Unauthenticated." }
```

Recommended statuses:

- `400` validation or malformed JSON
- `401` unauthenticated
- `403` authenticated but forbidden, or origin check failure
- `404` user-owned record not found under current user
- `413` request body too large
- `429` rate limit exceeded
- `500` unexpected server error with generic message

### Rate Limit Contract

For assistant requests:

- Default: 10 requests per minute.
- Key: `user:${userId}` when authenticated, otherwise `ip:${clientIp}`.
- On limit exceeded:
  - status `429`
  - JSON body `{ "error": "Rate limit exceeded." }`
  - `Retry-After` header in seconds

### Security Header Baseline

Recommended starting point:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.openai.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Notes:

- Revisit CSP after Auth.js provider redirects and Next font behavior are verified.
- Avoid HSTS in local development.
- `unsafe-inline` and `unsafe-eval` may be needed initially for Next development behavior; tighten production CSP after testing.

## Final Verification Commands

Run these after implementation:

```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm run test:unit
npm run test:unit -- --coverage
npm run test:acceptance
npm audit --audit-level=low
```

`npm run test:acceptance` requires PostgreSQL to be reachable at the configured `DATABASE_URL` before the test starts. In the current local setup, Docker must be running and `localhost:5433` must accept connections.

Add package scripts during implementation:

```json
{
  "verify": "npm run lint && npx tsc --noEmit --pretty false && npm run build && npm run test:unit && npm run test:acceptance",
  "test:coverage": "vitest run --coverage",
  "security:audit": "npm audit --audit-level=low"
}
```

## Phase 3.0 Exit Criteria

Security criteria:

- Real authentication is in place.
- The hardcoded local-user runtime identity is removed or limited to migration/test-only code.
- All protected API routes return `401` without a valid session.
- User-owned reads and writes are scoped to the authenticated user.
- `/api/assistant` has auth, prompt cap, rate limit, and `Retry-After`.
- Mutation routes enforce body-size limits, schema validation, max text lengths, and same-origin checks.
- Server-side highlight color allowlist is enforced.
- Required HTTP security headers are verified in live responses.
- `npm audit` has zero critical/high findings.
- Remaining moderate advisories are documented in the security register.

Testing criteria:

- Coverage threshold is configured and passing.
- Auth rejection tests pass for all protected routes.
- Authorization tests prove user A cannot access user B data.
- Rate-limit tests pass for `/api/assistant`.
- Validation tests cover malformed JSON, oversized bodies, invalid colors, and overlong text.
- `generated-study-notes` and `import-runs` have route tests.
- At least one DB integration suite exercises real Prisma queries and ownership constraints.
- Acceptance test has a PostgreSQL preflight and passes in the configured local/CI environment.

## Known Corrections From The Copilot Report

- `app/api/import-runs` is currently a `GET` route, not a mutation route. It still needs auth and tests, but it is not a write endpoint.
- `app/api/generated-study-notes` persists client-provided assistant output. It does not itself call OpenAI.
- The project does not have a configured coverage gate, but a manual coverage run did produce a baseline: 80% lines, 78.08% statements, 64.56% branches, and 71.96% functions.
- Pages Router `bodyParser.sizeLimit` config is not the right primary mechanism for App Router route handlers. Use a shared limited JSON reader.
