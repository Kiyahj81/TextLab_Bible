# TextLab Bible Security and Test-Gap Remediation Plan

# Archived: This plan was replaced by the newer security-testing-remediation-plan.md file.

## Summary
Audit target: current Next.js/Prisma app in `C:\Users\kiyah\Codex Projects\TextLab_Bible`, with the selected posture **Auth.js now**. Current gates: `lint`, `tsc`, `test:unit`, `test:unit -- --coverage`, and `build` passed. `test:acceptance` failed because PostgreSQL is not reachable at `localhost:5433`. `npm audit` reports 2 moderate Next/PostCSS advisories.

## Findings By Severity
**High**
- No real auth or authorization: [lib/user.ts](C:/Users/kiyah/Codex%20Projects/TextLab_Bible/lib/user.ts:1) hardcodes `local-user`; all user-owned APIs and pages scope to that shared id. If exposed beyond localhost, any visitor can read/write/delete notes, highlights, saved searches, generated notes, and run assistant requests.
- AI cost/abuse risk: [app/api/assistant/route.ts](C:/Users/kiyah/Codex%20Projects/TextLab_Bible/app/api/assistant/route.ts:5) is unauthenticated and has no per-user rate limit, so live OpenAI synthesis can be triggered repeatedly when `OPENAI_API_KEY` is set.

**Medium**
- User-scoped reader data is not filtered by user inside [lib/search.ts](C:/Users/kiyah/Codex%20Projects/TextLab_Bible/lib/search.ts:98); note/highlight includes would leak cross-user data after auth unless fixed.
- Input validation is ad hoc: many routes call `request.json()` without a shared safe parser or length limits; highlight colors accept any string in [app/api/highlights/route.ts](C:/Users/kiyah/Codex%20Projects/TextLab_Bible/app/api/highlights/route.ts:85).
- Security headers are absent; [next.config.ts](C:/Users/kiyah/Codex%20Projects/TextLab_Bible/next.config.ts:3) only sets `outputFileTracingRoot`.
- Dependency audit: `next@15.5.18` bundles `postcss@8.4.31`, producing GHSA-qx2v-qp2m-jg93. Do not run `npm audit fix --force`; it proposes a breaking downgrade path.

**Low**
- `.env.example` exists locally but is ignored by `.gitignore`, while README setup depends on it.
- Acceptance tests lack a DB preflight and currently fail after waiting for `/read`; `Test-NetConnection localhost -Port 5433` returned `TcpTestSucceeded: False`.
- Coverage exists but has no enforced threshold: current coverage is 78.08% statements, 64.56% branches, 71.96% functions, 80% lines.

## Implementation Plan
- Add Auth.js v5 using `next-auth@beta` and `@auth/prisma-adapter`, following the official Auth.js setup: create root `auth.ts`, add `app/api/auth/[...nextauth]/route.ts`, and use `auth()` checks at pages/routes close to data access rather than relying on middleware alone.
- Add Auth.js Prisma models and a migration. Insert a placeholder `User` with id `local-user` before adding FKs so existing local data remains valid. Add FK relations from `Note`, `SavedSearch`, `GeneratedStudyNote`, `Highlight`, and `AiSession` to `User`.
- Replace `localUserId` with `requireUserId()` / `getOptionalUserId()` helpers. All protected API routes return `401 { error: "Unauthenticated." }` without a session. Protected pages should redirect to the sign-in route.
- Configure providers: GitHub OAuth for production via `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`; a dev/test-only credentials provider enabled only when `TEXTLAB_TEST_AUTH=1` or non-production explicit dev env is set. Require `AUTH_SECRET`.
- Add same-origin protection for `POST`, `PATCH`, and `DELETE`: reject missing or mismatched `Origin`/`Host` with `403`.
- Add `zod` validation and shared helpers: `safeJson()`, `jsonError()`, route schemas, and normalized limits. Defaults: prompt 4000 chars, note body/generated markdown 10000 chars, title/label 200 chars, tags max 20 and 32 chars each, citations max 50, `englishWordIndex >= 0`, highlight color must match `HIGHLIGHT_COLORS`.
- Add simple in-memory per-user rate limiting for now: assistant 10 requests/minute, writes 60 requests/minute. Return `429 { error: "Rate limit exceeded." }`. Document Redis/Upstash as the production replacement.
- Update data scoping: pass `userId` into reader/search/note helpers and filter included `notes`/`highlights` by `userId`.
- Add security headers in `next.config.ts`: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`, and `frame-ancestors 'none'`.
- Fix env/docs: stop ignoring `.env.example`, track a sanitized file with `DATABASE_URL`, `AUTH_SECRET`, OAuth placeholders, test-auth flag, and OpenAI settings. Add scripts: `verify`, `test:coverage`, and `security:audit`.

## Test Plan
- Unit tests for auth helpers: unauthenticated 401, authenticated user id extraction, dev/test provider gating, and production misconfiguration failure.
- API tests for every protected route: no session returns 401; user A cannot read/update/delete user B data; malformed JSON returns 400; cross-origin writes return 403; rate limits return 429.
- Validation tests: max lengths, empty strings, invalid ids, invalid tags/citations, and invalid highlight colors do not call Prisma writes.
- Reader/search tests: `getReaderPassage(userId, ...)` includes only the current user’s notes/highlights.
- Add missing coverage for `searchKeyword`, `searchMorphology`, generated-study-notes route, import-runs route, assistant route validation, and security headers.
- Improve acceptance test: preflight DB connectivity before starting Next, fail with an actionable message if `localhost:5433` is unavailable, then run the existing golden path under test auth.
- Final verification command: `npm run lint`, `npx tsc --noEmit --pretty false`, `npm run build`, `npm run test:unit`, `npm run test:coverage`, `npm run test:acceptance`, `npm run security:audit`.

## Assumptions And References
- Auth scope is production-ready Auth.js, per your selection.
- Keep architecture simple: no Redis dependency in this pass; rate limiting is single-process with a documented production swap.
- Official Auth.js references: [installation](https://authjs.dev/getting-started/installation), [protecting resources](https://authjs.dev/getting-started/session-management/protecting), and [Prisma adapter](https://authjs.dev/getting-started/adapters/prisma).
- Dependency advisory reference: [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93).
