# Production Launch Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production at text-lab-bible.vercel.app usable and protected: fix the prisma migration EOL drift at the root, ship an email-allowlisted GitHub OAuth sign-in, and back the API rate limiter with Upstash Redis so it works on serverless.

**Architecture:** Three sequential PRs (spec: `docs/superpowers/specs/2026-06-11-production-launch-followups-design.md`). PR 1 is docs/hygiene only. PR 2 adds a `signInCallback` allowlist to the existing Auth.js callback module plus ops setup performed by the maintainer. PR 3 adds an async `checkRateLimit` facade to `lib/rate-limit.ts` that picks Upstash → in-memory → allow.

**Tech Stack:** Next 15 / Auth.js v5, Prisma 6 + Neon, Vitest 4, `@upstash/ratelimit` + `@upstash/redis`, Vercel.

**Process rules (apply to every PR):**
- Work on the named branch; never commit to `main` (protected; PR + green `Eval Gate / gate` required).
- After pushing and opening the PR, **stop and wait for the maintainer** to review (including Codex bot comments) and merge. Do not poll or merge.
- `npm run verify` must pass before every push. Branch PR 2 and PR 3 off `main` only after the previous PR has merged.

---

## PR 1 — Docs & repo hygiene

Branch: `chore/docs-hygiene` off `main`. (The design spec and this plan were merged ahead of the arc via the standalone `docs/production-launch-followups` PR.)

### Task 1: `.gitattributes` — LF for migration SQL

**Files:**
- Create: `.gitattributes`

- [ ] **Step 1: Create the file**

```gitattributes
# Prisma computes migration checksums from working-tree bytes. With
# core.autocrlf=true on Windows, CRLF checkout made `prisma migrate dev`
# report false drift on every migration. Force LF so checkout bytes match
# what was applied with `migrate deploy`.
prisma/migrations/**/*.sql text eol=lf
```

- [ ] **Step 2: Renormalize the already-tracked SQL**

Run: `git add --renormalize prisma/migrations`
Then: `git status --short`
Expected: zero or more `M prisma/migrations/...` lines (files whose index content changes to LF). Zero modified files is also fine — it means the index was already LF and only future checkouts change.

- [ ] **Step 3: Verify migration state is clean**

Run: `npx prisma migrate status`
Expected: lists all 12 migrations as applied, ends with `Database schema is up to date!` (uses `.env` → dev Neon branch). If it fails with a TLS error, the shell is missing `NODE_OPTIONS=--use-system-ca` (see README Windows TLS Note).

- [ ] **Step 4: Commit**

```bash
git add .gitattributes prisma/migrations
git commit -m "Force LF on prisma migration SQL to stop false checksum drift"
```

### Task 2: PROJECT_STATE.md — resolve the database-topology open item

**Files:**
- Modify: `docs/PROJECT_STATE.md:3` (snapshot line), `docs/PROJECT_STATE.md:341-345` ("What's still outside Phase 3.0 scope" list)

- [ ] **Step 1: Update the snapshot line (line 3)**

Append to the end of the parenthetical, before the closing `)*`:

```
; a production-launch follow-ups arc is underway — docs/hygiene, sign-in allowlist + GitHub OAuth, Upstash rate limiter (spec: docs/superpowers/specs/2026-06-11-production-launch-followups-design.md)
```

- [ ] **Step 2: Replace the launch-readiness list**

Replace the three bullets under `What's still outside Phase 3.0 scope for a real public launch:` with:

```markdown
- ✅ **Production database topology — resolved 2026-06-11.** Production (Vercel) and local
  dev share the `ep-tiny-queen` Neon branch; integration/acceptance/eval use the
  `ep-restless-union` branch via `.env.test`. The Vercel project had silently pointed at the
  wrong Neon project since 2026-05-27; repointed and verified 2026-06-11. Public-launch
  retention/backup/storage-budget policy remains deferred until the audience grows beyond
  personal use.
- Production OAuth credentials and a stable `AUTH_URL` — **PR 2 of the production-launch
  follow-ups arc**, together with an `AUTH_ALLOWED_EMAILS` sign-in allowlist (production is
  single-user for now).
- Move the in-memory rate limiter to Upstash Redis (Vercel Marketplace) — **PR 3 of the same
  arc**; the current limiter no-ops on serverless by design.
```

- [ ] **Step 3: Commit**

```bash
git add docs/PROJECT_STATE.md
git commit -m "Record resolved Neon topology and the production-launch arc in PROJECT_STATE"
```

### Task 3: README.md — deployment topology + follow-ups list

**Files:**
- Modify: `README.md` (new `## Deployment` section after the Environment Variables section, i.e. after line 171; one bullet added to `## Current Follow-Ups`, line 223)

- [ ] **Step 1: Insert the Deployment section**

Insert between the Environment Variables section's closing paragraph (line 171) and `## Commands` (line 173):

```markdown
## Deployment

Production runs on Vercel at `https://text-lab-bible.vercel.app`, deploying `main` on merge.
It uses the same Neon PostgreSQL branch as local development (pooled `DATABASE_URL` plus
direct `DIRECT_URL`, set in the Vercel project's Production environment); integration,
acceptance, and eval runs use a separate Neon branch via `.env.test`. Production sign-in
requires the GitHub OAuth variables above — until they are set, the deployed `/signin` page
reports that no providers are configured.
```

- [ ] **Step 2: Add the arc to Current Follow-Ups**

Add as the first bullet of `## Current Follow-Ups`:

```markdown
- **Production launch arc (in progress):** GitHub OAuth + `AUTH_ALLOWED_EMAILS` sign-in allowlist, then Upstash-backed rate limiting. Spec: `docs/superpowers/specs/2026-06-11-production-launch-followups-design.md`.
```

- [ ] **Step 3: Read the surrounding README sections and confirm coherence** (CLAUDE.md requires the README to read as one unified document — check the new section doesn't contradict Local Setup or Smoke Path).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document the Vercel/Neon deployment topology in README"
```

### Task 4: security-register.md — close out the Vercel mis-wiring

**Files:**
- Modify: `docs/security-register.md:191-193` (the `## Closed` section, currently `_None yet._`)

- [ ] **Step 1: Replace `_None yet._` under `## Closed` with:**

```markdown
### Production Vercel project pointed at the wrong Neon database (2026-05-27 → 2026-06-11)

| Field | Value |
| --- | --- |
| Severity | Moderate (availability/integrity — production wrote to an unintended database) |
| Issue | The Vercel project's Production `DATABASE_URL`/`DIRECT_URL` pointed at a leftover ai-sdk-rag-starter Neon project instead of the TextLab Bible project, silently, since the 2026-05-27 deploy. |
| Detection | Found 2026-06-11 while applying the saved-search domain-filters migration to all live environments. |
| Resolution | Production env vars repointed at the `ep-tiny-queen` branch of the correct Neon project; redeployed and verified 2026-06-11. No real user data existed in the wrong database (production had no working sign-in provider). |
| Prevention | Deployment topology is now documented in README (Deployment) and PROJECT_STATE; env-var inventory tracked here as of the production-launch arc. |
| Owner | Maintainer (kiyahj81) |
| Closed | 2026-06-11 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/security-register.md
git commit -m "Close out the Vercel-to-Neon mis-wiring in the security register"
```

### Task 5: Verify, push, open PR 1, stop

- [ ] **Step 1:** Run `npm run verify` — expected exit 0 (docs-only changes; build must still pass).
- [ ] **Step 2:** Push: `git push -u origin docs/production-launch-followups`
- [ ] **Step 3:** Open the PR (title: "Docs hygiene: LF migrations, resolved Neon topology, launch-arc spec"). Body summarizes the four commits and links the spec.
- [ ] **Step 4:** **Stop. Report to the maintainer and wait for review/merge.**

---

## PR 2 — Sign-in allowlist + production OAuth + smoke test

Branch: `feat/auth-allowlist` off `main` **after PR 1 merges**.

### Task 6: `signInCallback` — failing tests first

**Files:**
- Test: `tests/unit/lib/auth-allowlist.test.ts` (create)

- [ ] **Step 1: Write the failing test file**

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { signInCallback } from "@/lib/auth-callbacks";

const ORIGINAL = process.env.AUTH_ALLOWED_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
  else process.env.AUTH_ALLOWED_EMAILS = ORIGINAL;
});

function withEmail(email: string | null | undefined) {
  return { user: { email } };
}

describe("signInCallback — AUTH_ALLOWED_EMAILS allowlist", () => {
  it("allows everyone when the variable is unset", () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    expect(signInCallback(withEmail("anyone@example.com"))).toBe(true);
  });

  it("allows everyone when the variable is blank", () => {
    process.env.AUTH_ALLOWED_EMAILS = "   ";
    expect(signInCallback(withEmail("anyone@example.com"))).toBe(true);
  });

  it("allows a listed email", () => {
    process.env.AUTH_ALLOWED_EMAILS = "owner@example.com";
    expect(signInCallback(withEmail("owner@example.com"))).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    process.env.AUTH_ALLOWED_EMAILS = " Owner@Example.com , second@example.com ";
    expect(signInCallback(withEmail("owner@EXAMPLE.com"))).toBe(true);
    expect(signInCallback(withEmail("SECOND@example.COM"))).toBe(true);
  });

  it("denies an unlisted email", () => {
    process.env.AUTH_ALLOWED_EMAILS = "owner@example.com";
    expect(signInCallback(withEmail("intruder@example.com"))).toBe(false);
  });

  it("denies a user with no email when a list is set", () => {
    process.env.AUTH_ALLOWED_EMAILS = "owner@example.com";
    expect(signInCallback(withEmail(null))).toBe(false);
    expect(signInCallback(withEmail(undefined))).toBe(false);
    expect(signInCallback({ user: null })).toBe(false);
  });

  it("ignores empty entries from stray commas", () => {
    process.env.AUTH_ALLOWED_EMAILS = "owner@example.com,,";
    expect(signInCallback(withEmail("owner@example.com"))).toBe(true);
    expect(signInCallback(withEmail("intruder@example.com"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/auth-allowlist.test.ts`
Expected: FAIL — `signInCallback` is not exported from `@/lib/auth-callbacks`.

### Task 7: `signInCallback` — implementation

**Files:**
- Modify: `lib/auth-callbacks.ts` (append after `signOutEvent`, line 64)

- [ ] **Step 1: Append the implementation**

```typescript
// Sign-in allowlist. AUTH_ALLOWED_EMAILS is a comma-separated email list;
// when set, only listed emails may sign in (any provider). Unset or blank
// allows everyone — local dev and the test suites rely on that — so
// production MUST set it: without it, any GitHub account can sign in and
// use the assistant on the maintainer's OpenAI key.
export function signInCallback({
  user
}: {
  user?: { email?: string | null } | null;
}): boolean {
  const raw = process.env.AUTH_ALLOWED_EMAILS;
  if (!raw || raw.trim() === "") return true;

  const allowed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;

  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  return allowed.includes(email);
}
```

- [ ] **Step 2: Run the test again**

Run: `npx vitest run tests/unit/lib/auth-allowlist.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add lib/auth-callbacks.ts tests/unit/lib/auth-allowlist.test.ts
git commit -m "Add AUTH_ALLOWED_EMAILS sign-in allowlist callback"
```

### Task 8: Wire the callback into Auth.js

**Files:**
- Modify: `auth.ts:6` (import) and `auth.ts:90-93` (callbacks block)

- [ ] **Step 1: Update the import**

```typescript
import { jwtCallback, sessionCallback, signInCallback, signOutEvent } from "@/lib/auth-callbacks";
```

- [ ] **Step 2: Add to the callbacks block**

```typescript
  callbacks: {
    signIn: signInCallback,
    jwt: jwtCallback,
    session: sessionCallback
  },
```

If `tsc` rejects the assignment (Auth.js's `signIn` callback type carries extra params like `account`/`profile` we don't declare), widen the callback's parameter type in `lib/auth-callbacks.ts` to accept-and-ignore them rather than casting at the wiring site.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add auth.ts lib/auth-callbacks.ts
git commit -m "Enforce the sign-in allowlist in the Auth.js config"
```

### Task 9: `/signin` AccessDenied copy — extract + test

A denied sign-in redirects to `/signin?error=AccessDenied` (the configured error page). The message map currently lives inline in the server component where it can't be unit-tested; extract it.

**Files:**
- Create: `app/signin/errorMessages.ts`
- Modify: `app/signin/page.tsx:11-17` (remove inline map), `app/signin/page.tsx:33` (use helper)
- Test: `tests/unit/app/signin-error-messages.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "@/app/signin/errorMessages";

describe("signInErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(signInErrorMessage(undefined)).toBeNull();
  });

  it("maps AccessDenied to the invite-only message", () => {
    expect(signInErrorMessage("AccessDenied")).toMatch(/invite-only/i);
  });

  it("keeps the existing known codes", () => {
    expect(signInErrorMessage("CredentialsSignin")).toBe("Invalid credentials.");
    expect(signInErrorMessage("Configuration")).toMatch(/misconfigured/i);
  });

  it("falls back to the generic message for unknown codes", () => {
    expect(signInErrorMessage("SomethingNew")).toMatch(/something went wrong/i);
  });
});
```

Run: `npx vitest run tests/unit/app/signin-error-messages.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Create `app/signin/errorMessages.ts`**

```typescript
// Auth.js redirects failed sign-ins to /signin?error=<code>. Map the codes
// we expect to user-facing copy; anything unknown gets the generic message.
const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid credentials.",
  OAuthAccountNotLinked:
    "That account is registered with a different provider. Sign in the original way.",
  Configuration: "Sign-in is misconfigured. Check server logs.",
  AccessDenied:
    "This app is invite-only. Your account isn't on the access list — contact the maintainer if you think it should be.",
  default: "Something went wrong signing you in."
};

export function signInErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.default;
}
```

- [ ] **Step 3: Use it in `app/signin/page.tsx`**

Delete the inline `ERROR_MESSAGES` constant (lines 11–17), add the import, and replace line 33:

```typescript
import { signInErrorMessage } from "./errorMessages";
```

```typescript
  const initialError = signInErrorMessage(errorCode);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/app/signin-error-messages.test.ts` then `npx tsc --noEmit --pretty false`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/signin/errorMessages.ts app/signin/page.tsx tests/unit/app/signin-error-messages.test.ts
git commit -m "Show invite-only copy for AccessDenied sign-in errors"
```

### Task 10: Document the new variable

**Files:**
- Modify: `.env.example:52` (append after the `AUTH_DEV_ENABLED` block), `README.md:160-161` (env table)

- [ ] **Step 1: Append to `.env.example`**

```bash
# Sign-in allowlist (production). Comma-separated emails; when set, only these
# emails may sign in (any provider). Unset/blank allows everyone — fine locally,
# never leave unset in production.
AUTH_ALLOWED_EMAILS=""
```

- [ ] **Step 2: Add a README env-table row** (after the `GITHUB_CLIENT_ID` row, line 161):

```markdown
| `AUTH_ALLOWED_EMAILS` | Production | Comma-separated sign-in allowlist. When set, only listed emails may sign in; unset allows everyone (local dev). |
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "Document AUTH_ALLOWED_EMAILS in .env.example and README"
```

### Task 11: security-register — production auth env inventory

**Files:**
- Modify: `docs/security-register.md` (new entry at the end of `## Open`)

- [ ] **Step 1: Append under `## Open`:**

```markdown
### Production auth environment (Vercel) — secret inventory

| Field | Value |
| --- | --- |
| Severity | Informational (secret-management inventory) |
| Change | Production sign-in (launch-arc PR 2) requires five variables in the Vercel project's **Production** environment: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_ALLOWED_EMAILS`. |
| Handling | Values entered via the **Vercel web UI**, never CLI paste (Windows PowerShell paste can embed a trailing CR in secrets — known failure mode with `gh secret set`). `AUTH_SECRET` is generated fresh for production, not copied from `.env`. Names only are recorded here, never values. |
| Trust boundary | GitHub becomes the production identity provider (OAuth). The allowlist (`AUTH_ALLOWED_EMAILS`) bounds who can create accounts; without it any GitHub account could sign in and spend OpenAI credits via the assistant. |
| Status | Accepted — inventory recorded |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-11 (production-launch arc PR 2) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/security-register.md
git commit -m "Record the production auth secret inventory in the security register"
```

### Task 12: Verify, push, open PR 2, stop

- [ ] **Step 1:** Run `npm run verify` — exit 0. Run `npm run test:acceptance` — exit 0 (allowlist unset in `.env.test`, so dev-credentials sign-in is unaffected; this proves it).
- [ ] **Step 2:** Push: `git push -u origin feat/auth-allowlist`
- [ ] **Step 3:** Open the PR (title: "Add AUTH_ALLOWED_EMAILS sign-in allowlist and invite-only error copy").
- [ ] **Step 4:** **Stop. Report to the maintainer and wait for review/merge.**

### Task 13: Ops — GitHub OAuth app + Vercel env (maintainer performs, after PR 2 merges)

No code. The assistant walks the maintainer through it; the maintainer clicks.

- [ ] **Step 1:** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:
  - Application name: `TextLab Bible`
  - Homepage URL: `https://text-lab-bible.vercel.app`
  - Authorization callback URL: `https://text-lab-bible.vercel.app/api/auth/callback/github`
  - Generate a client secret; keep the tab open.
- [ ] **Step 2:** Generate `AUTH_SECRET` locally: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- [ ] **Step 3:** Vercel → project → Settings → Environment Variables → **Production** scope, via the web UI (not CLI):
  - `GITHUB_CLIENT_ID` = (from Step 1)
  - `GITHUB_CLIENT_SECRET` = (from Step 1)
  - `AUTH_SECRET` = (from Step 2)
  - `AUTH_URL` = `https://text-lab-bible.vercel.app`
  - `AUTH_ALLOWED_EMAILS` = the maintainer's email (the one on the GitHub account, or any email — comparison is against the OAuth profile email)
  - Confirm `AUTH_DEV_ENABLED` is **absent** from Production.
- [ ] **Step 4:** Redeploy (Vercel → Deployments → Redeploy latest `main`), wait for green.

### Task 14: Production smoke test (maintainer + assistant)

- [ ] **Step 1:** Visit `https://text-lab-bible.vercel.app/signin` → "Continue with GitHub" appears (no "no providers" warning).
- [ ] **Step 2:** Sign in with GitHub → lands on `/read`.
- [ ] **Step 3:** `/search` → Domain mode → pick a domain → Search → Save → saved search appears in the sidebar → click it → full domain search round-trips.
- [ ] **Step 4:** `/assistant` → one scoped question (e.g. `Show me every use of logos in John 1`) → answer with citations renders.
- [ ] **Step 5:** Sign out → revisiting `/read` redirects to `/signin`.
- [ ] **Step 6 (optional, second browser/incognito with a different GitHub account):** sign-in is refused with the invite-only message.
- [ ] **Step 7:** Report results; this closes the "production smoke test" follow-up from the domain-saved-searches arc.

---

## PR 3 — Upstash-backed rate limiter

Branch: `feat/upstash-rate-limit` off `main` **after PR 2 merges**.

### Task 15: Install dependencies

- [ ] **Step 1:** Run: `npm install @upstash/ratelimit @upstash/redis`
  (If TLS errors: `npm install` cannot self-arm; the user-scope `NODE_OPTIONS=--use-system-ca` must be in the shell environment.)
- [ ] **Step 2:** Commit:

```bash
git add package.json package-lock.json
git commit -m "Add @upstash/ratelimit and @upstash/redis"
```

### Task 16: `checkRateLimit` facade — failing tests first

**Files:**
- Test: `tests/unit/lib/rate-limit.test.ts` (extend)

- [ ] **Step 1: Add mocks + a new describe block**

Update the imports at the top of the file:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  consume,
  getClientIp,
  rateLimitKey,
  resetRateLimits,
  shouldEnforceLocalRateLimit
} from "@/lib/rate-limit";

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) }
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = vi.fn((requests: number, window: string) => ({ requests, window }));
    limit = limitMock;
  }
  return { Ratelimit };
});
```

Append the new suite at the end of the file:

```typescript
describe("checkRateLimit — backend selection", () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const savedVercel = process.env.VERCEL;
  // Effectively no refill within a test run, so the in-memory path is deterministic.
  const slowOpts = { burst: 3, refillPerSecond: 0.001 };

  function setUpstashEnv() {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  }

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    if (savedToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    resetRateLimits();
    limitMock.mockReset();
  });

  it("uses Upstash when its env vars are set and allows on success", async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: true, remaining: 7, reset: Date.now() + 30_000 });
    const result = await checkRateLimit("k", slowOpts);
    expect(result).toEqual({ allowed: true, remaining: 7 });
    expect(limitMock).toHaveBeenCalledWith("k");
  });

  it("maps an Upstash denial's reset timestamp to retryAfterSeconds", async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 30_000 });
    const result = await checkRateLimit("k", slowOpts);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unexpected allowed");
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(31);
  });

  it("fails open when the Upstash client throws", async () => {
    setUpstashEnv();
    limitMock.mockRejectedValue(new Error("redis down"));
    const result = await checkRateLimit("k", slowOpts);
    expect(result.allowed).toBe(true);
  });

  it("falls back to the in-memory bucket when Upstash is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit("mem", slowOpts)).allowed).toBe(true);
    }
    expect((await checkRateLimit("mem", slowOpts)).allowed).toBe(false);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("allows everything on serverless without Upstash (explicit last resort)", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.VERCEL = "1";
    for (let i = 0; i < 20; i++) {
      expect((await checkRateLimit("sv", slowOpts)).allowed).toBe(true);
    }
    expect(limitMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts`
Expected: FAIL — `checkRateLimit` is not exported. The pre-existing suites in the file must still pass.

### Task 17: `checkRateLimit` facade — implementation

**Files:**
- Modify: `lib/rate-limit.ts` (header comment lines 1–9, `resetRateLimits` lines 58–60, new code appended)

- [ ] **Step 1: Replace the header comment (lines 1–9)**

```typescript
// Rate limiting with three backends, picked by checkRateLimit() in priority order:
//   1. Upstash Redis sliding window — when UPSTASH_REDIS_REST_URL/_TOKEN are set
//      (the Vercel Marketplace integration injects them). State lives in Redis,
//      so this works on serverless where process memory does not survive.
//   2. In-memory token bucket — local/single-VM dev without Upstash.
//   3. Allow — serverless without Upstash configured. shouldEnforceLocalRateLimit()
//      returns false there so the in-memory bucket never silently pretends to
//      gate traffic it cannot see.
```

- [ ] **Step 2: Add imports at the top**

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
```

- [ ] **Step 3: Update `resetRateLimits` and append the facade**

```typescript
export function resetRateLimits(): void {
  buckets.clear();
  upstashLimiters.clear();
}
```

Append at the end of the file:

```typescript
function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

// One Ratelimit instance per distinct options shape; @upstash/ratelimit
// recommends reusing instances (each carries its own ephemeral cache).
const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(options: RateLimitOptions): Ratelimit {
  // Map the bucket shape onto a sliding window: `burst` requests per the
  // time it takes the bucket to fully refill (10 burst at 10/min → 10 per 60 s).
  const windowSeconds = Math.max(1, Math.ceil(options.burst / options.refillPerSecond));
  const cacheKey = `${options.burst}:${windowSeconds}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(options.burst, `${windowSeconds} s` as `${number} s`),
    prefix: "textlab:ratelimit"
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

// Async facade over the available backends — see the header comment for the
// priority order. Upstash errors fail open: for a single-user allowlisted
// app, availability beats strictness; the error is logged so it is not silent.
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  if (upstashConfigured()) {
    try {
      const result = await getUpstashLimiter(options).limit(key);
      if (result.success) {
        return { allowed: true, remaining: result.remaining };
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return { allowed: false, retryAfterSeconds };
    } catch (error) {
      console.error("rate-limit: Upstash check failed; allowing request", error);
      return { allowed: true, remaining: 0 };
    }
  }

  if (shouldEnforceLocalRateLimit()) {
    return consume(key, options);
  }

  return { allowed: true, remaining: options.burst };
}
```

Note: `upstashLimiters` is referenced by `resetRateLimits` above its declaration — that's fine for a `const` Map only touched at call time, but if lint complains (`no-use-before-define`), move the `upstashLimiters` declaration above `resetRateLimits` instead of suppressing.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts` then `npx tsc --noEmit --pretty false`
Expected: PASS (all suites, old and new) / exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.ts tests/unit/lib/rate-limit.test.ts
git commit -m "Add checkRateLimit facade with Upstash, in-memory, and allow backends"
```

### Task 18: Switch the assistant route to the facade

**Files:**
- Modify: `app/api/assistant/route.ts:12-17` (imports), `app/api/assistant/route.ts:46-55` (rate-limit block)
- Test: `tests/unit/api/assistant-route.test.ts` (existing 429 test keeps passing unchanged — it runs with no Upstash env, so the facade routes to the in-memory bucket)

- [ ] **Step 1: Update the imports**

```typescript
import { checkRateLimit, getClientIp, rateLimitKey } from "@/lib/rate-limit";
```

- [ ] **Step 2: Replace the rate-limit block (the `if (shouldEnforceLocalRateLimit()) { ... }` wrapper goes away — the facade owns backend selection now)**

```typescript
  const ip = getClientIp(request.headers);
  const key = rateLimitKey({ userId, ip, scope: "assistant" });
  const limit = await checkRateLimit(key, ASSISTANT_RATE_LIMIT);
  if (!limit.allowed) {
    const response = jsonError("Rate limit exceeded.", 429);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }
```

- [ ] **Step 3: Run the route tests**

Run: `npx vitest run tests/unit/api/assistant-route.test.ts`
Expected: PASS — including the existing "429 with Retry-After after burst exhaustion" test, now flowing through the facade's in-memory path.

- [ ] **Step 4: Commit**

```bash
git add app/api/assistant/route.ts
git commit -m "Route assistant rate limiting through the checkRateLimit facade"
```

### Task 19: Document the Upstash variables

**Files:**
- Modify: `.env.example` (append at end), `README.md` env table (after the `AI_GATEWAY_API_KEY` row, line 167)

- [ ] **Step 1: Append to `.env.example`**

```bash
# --- Upstash rate limiting (production) ---
# Injected automatically by the Vercel Marketplace Upstash integration. Their
# PRESENCE routes API rate limiting through Upstash Redis (works on serverless).
# Unset locally → the in-memory bucket is used instead.
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
```

- [ ] **Step 2: Add the README env-table row**

```markdown
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Production | Back API rate limiting with Upstash Redis (set automatically by the Vercel Marketplace integration). Unset: in-memory limiter locally, no limiting on serverless. |
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "Document the Upstash rate-limit variables"
```

### Task 20: PROJECT_STATE + security-register close-out

**Files:**
- Modify: `docs/PROJECT_STATE.md` (the launch-readiness list updated in Task 2), `docs/security-register.md` (new entry under `## Open`)

- [ ] **Step 1: PROJECT_STATE** — mark the rate-limiter bullet resolved:

```markdown
- ✅ **Serverless rate limiting — resolved (launch-arc PR 3).** `checkRateLimit` in
  `lib/rate-limit.ts` uses Upstash Redis (Vercel Marketplace integration) when configured,
  the in-memory bucket locally, and only falls back to allow on serverless without Upstash.
```

Also mark the OAuth bullet resolved if Task 13/14 are done by then (✅ with the date); otherwise leave it.

- [ ] **Step 2: security-register** — append under `## Open`:

```markdown
### Upstash Redis — rate-limit backend (new processor)

| Field | Value |
| --- | --- |
| Severity | Low (data-egress consideration) |
| Change | Launch-arc PR 3 backs `checkRateLimit` with Upstash Redis via `@upstash/ratelimit` when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set (Vercel Marketplace integration). |
| Data sent | Rate-limit keys only — `assistant:user:<internal-user-id>` or `assistant:ip:<client-ip>` — plus counters/timestamps. No prompts, verse text, or user content. |
| Trust boundary | Upstash becomes a new sub-processor holding pseudonymous identifiers (internal IDs, IPs). Free tier; data confined to the configured Redis database. |
| Failure posture | Fail-open with a logged error — for a single-user allowlisted app, availability beats strictness. Revisit (fail-closed or queue) if the app ever opens to the public. |
| Status | Accepted |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-11 (production-launch arc PR 3) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/PROJECT_STATE.md docs/security-register.md
git commit -m "Close the serverless rate-limiter item; record Upstash in the security register"
```

### Task 21: Verify, push, open PR 3, stop

- [ ] **Step 1:** Run `npm run verify` — exit 0. Run `npm run test:integration` — exit 0 (no schema changes; sanity).
- [ ] **Step 2:** Push: `git push -u origin feat/upstash-rate-limit`
- [ ] **Step 3:** Open the PR (title: "Back API rate limiting with Upstash Redis on serverless").
- [ ] **Step 4:** **Stop. Report to the maintainer and wait for review/merge.**

### Task 22: Ops — install Upstash + production check (maintainer performs, after PR 3 merges)

- [ ] **Step 1:** Vercel → Marketplace → Upstash → install into the project, Redis (free tier), all environments or Production. Confirm `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` appear under the project's env vars.
- [ ] **Step 2:** Redeploy `main`; wait for green.
- [ ] **Step 3:** Signed in on production, fire 11 rapid assistant requests (e.g. resubmit the same prompt). Expected: the 11th returns the rate-limit error (429 with `Retry-After`). Confirm the Upstash console shows `textlab:ratelimit` keys.
- [ ] **Step 4:** Report results — the arc is complete.
