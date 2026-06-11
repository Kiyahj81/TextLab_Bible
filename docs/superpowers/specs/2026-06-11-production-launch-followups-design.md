# Production launch follow-ups — design

**Date:** 2026-06-11
**Status:** Approved
**Context:** Follow-ups from the domain-saved-searches arc (PR #24). Production at
text-lab-bible.vercel.app now points at the correct Neon database but has no usable
sign-in: GitHub OAuth credentials were never configured, and the dev-credentials
provider is (correctly) disabled outside local. This arc makes production usable for
its intended audience and closes the remaining launch-readiness items in
PROJECT_STATE.

## Decisions (made with the maintainer)

- **Audience:** single user (the maintainer) for the foreseeable future. Production
  sign-in is therefore **invite-only via an email allowlist**, not open sign-up.
- **Rate limiter backing:** Upstash Redis via the Vercel Marketplace integration.
  With the allowlist in place this is defense-in-depth for the maintainer's own
  OpenAI spend, not abuse protection — but PROJECT_STATE has tracked "move the
  in-memory limiter off serverless no-op" since Phase 3.0, and this closes it.
- **Slicing:** three small PRs, shipped in sequence, each independently reviewable.
  The production smoke test happens right after PR 2 — it is not blocked behind the
  rate-limiter refactor.

## PR 1 — Docs & repo hygiene (no behavior change)

1. **`.gitattributes`** (new, repo root):

   ```
   prisma/migrations/**/*.sql text eol=lf
   ```

   plus `git add --renormalize prisma/migrations` in the same commit so existing
   SQL re-enters the index as LF. This removes the root cause of the false
   `prisma migrate dev` checksum drift (core.autocrlf converting migration SQL to
   CRLF on checkout). Verification: `npx prisma migrate status` against the dev
   branch reports all migrations applied, no drift. The hand-written-migration +
   `migrate deploy` workflow keeps working regardless.

2. **PROJECT_STATE.md** — update the snapshot line; rewrite the "What's still
   outside Phase 3.0 scope for a real public launch" list: the production database
   policy question is resolved (production + local dev share the `ep-tiny-queen`
   Neon branch; test/eval lives on `ep-restless-union`; the Vercel project was
   repointed from the wrong Neon project on 2026-06-11). The OAuth and
   rate-limiter items remain open with pointers to PRs 2–3 of this arc.

3. **README.md** — per CLAUDE.md, sweep for accuracy as one coherent document: add
   the deployment topology (where production runs, which database it uses) and
   note that production sign-in requires the PR 2 environment setup.

4. **docs/security-register.md** — per CLAUDE.md, record the resolved Vercel→Neon
   mis-wiring (production had silently pointed at the wrong Neon project since
   2026-05-27; fixed 2026-06-11) if not already present. No new advisories.

(This design doc and the implementation plan land ahead of the arc via their own
docs-only PR, so they are on `main` regardless of what is being worked on.)

## PR 2 — Production sign-in: allowlist + OAuth setup + smoke test

### Code

- **`signInCallback` in `lib/auth-callbacks.ts`** (same pattern as the existing
  `jwtCallback`/`sessionCallback`: lives outside `auth.ts` so it is testable
  without NextAuth runtime init), wired into `callbacks` in `auth.ts`.
  - Reads `AUTH_ALLOWED_EMAILS`: comma-separated emails, trimmed, compared
    case-insensitively against the signing-in user's email.
  - **Unset or empty ⇒ allow all.** Local dev, the test suites, and `.env.test`
    are untouched; production sets the variable. This is fail-open by design and
    documented in README's env-var table.
  - Applies to every provider (GitHub OAuth and the dev Credentials provider
    alike — locally the var is unset, so dev login is unaffected).
- **`/signin` error copy:** a denied sign-in lands on `/signin?error=AccessDenied`
  (the configured Auth.js error page). Map `AccessDenied` to a friendly
  "This app is invite-only" message alongside the existing error handling.

### Tests

- Unit tests for `signInCallback`: allowed email, denied email, case-insensitive
  match, multiple entries with whitespace, unset ⇒ allow, user without an email
  denied when the list is set.
- Sign-in page test for the `AccessDenied` copy.
- Existing acceptance suite unaffected (dev-credentials sign-in, allowlist unset).

### Ops (maintainer performs, assistant guides)

1. Create a GitHub OAuth app — callback URL
   `https://text-lab-bible.vercel.app/api/auth/callback/github`.
2. In the Vercel project's **Production** environment set: `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET`, `AUTH_SECRET` (freshly generated), `AUTH_URL`
   (`https://text-lab-bible.vercel.app`), `AUTH_ALLOWED_EMAILS` (maintainer's
   email). Use the **Vercel web UI**, not CLI paste — Windows PowerShell paste can
   embed trailing CR characters in secrets (known failure mode with `gh secret
   set`).
3. Record the env-var inventory (names + where they live, never values) in
   `docs/security-register.md`, matching the eval-secrets precedent.

### Production smoke test (closes follow-up #1 from the prior arc)

After PR 2 merges and the production deploy is green: sign in with GitHub, run a
domain search, save it, round-trip it from the sidebar, run one assistant query,
sign out. This validates the newly repointed production database end to end.

## PR 3 — Serverless rate limiter (Upstash)

### Infra

- Install **Upstash Redis** from the Vercel Marketplace (free tier: 500K
  commands/month). The integration injects `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` into the Vercel project; copy them into `.env` (or
  leave unset) for local dev as desired.
- Add dependencies: `@upstash/ratelimit`, `@upstash/redis`.

### Code

- `lib/rate-limit.ts` gains an async facade, `checkRateLimit(key, options)`,
  selecting a backend in priority order:
  1. **Upstash sliding window** when `UPSTASH_REDIS_REST_URL` +
     `UPSTASH_REDIS_REST_TOKEN` are set (works in any environment, including
     local if the vars are present);
  2. the existing **in-memory token bucket** when
     `shouldEnforceLocalRateLimit()` is true (local/single-VM, no Upstash);
  3. **allow** (the current serverless no-op, now only reachable when deployed
     serverless *without* Upstash configured).
- The existing exports (`consume`, the bucket, `getClientIp`, `rateLimitKey`)
  remain; call sites move to the facade. The assistant route's synchronous
  rate-limit block becomes a single `await checkRateLimit(...)`.
- Upstash's reset timestamp maps onto the existing `retryAfterSeconds` /
  `Retry-After` response contract (429 behavior unchanged from the client's view).
- **Fail-open on Upstash errors** (log the error, allow the request): for a
  single-user allowlisted app, availability beats strictness. The header comment
  in `lib/rate-limit.ts` is rewritten to describe the new tiering.

### Tests

- Facade backend-selection tests (Upstash vars present / absent / serverless).
- Upstash path with a mocked client: allowed, limited (Retry-After mapping),
  client-throw ⇒ fail-open allow.
- Existing in-memory bucket tests unchanged; assistant-route 429 test updated for
  the async call.

### Docs

- PROJECT_STATE: close the last launch-readiness item.
- README env-var table: the two Upstash variables.

## Out of scope

- Open/public sign-up, fairness-grade rate limiting, Neon retention/backup policy
  for a public launch (explicitly deferred until the audience changes).
- Any change to the dev-credentials provider or the JWT revocation scheme.
- English Snowball stemming, prose-sweep grounding, and other Phase 6 follow-ups —
  unrelated to this arc.

## Process

Each PR: branch → TDD → `npm run verify` (plus `test:integration` /
`test:acceptance` where relevant) → push → PR → **stop for maintainer review and
merge** (including Codex bot comments). The eval gate runs as the required `gate`
check. Execution is subagent-driven where tasks are independent.
