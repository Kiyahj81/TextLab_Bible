# Reader DB Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reader page survive Neon's transient connection drops by retrying its read path and degrading to a graceful "try again" card instead of a full-page crash.

**Architecture:** A small reusable `withDbRetry()` helper retries only transient connection errors (bounded backoff) and wraps the reader page's four top-level read operations (`Promise.all`). Two React error boundaries — a tailored `app/read/error.tsx` and a generic root `app/error.tsx` — catch anything that still throws. No production query logic changes; the retry is reader-read-path-only.

**Tech Stack:** Next.js 15 App Router (server components + client `error.tsx` boundaries), Prisma 6 over Neon Postgres, Vitest 4 (`globals: false`) + React Testing Library + jsdom for component tests.

Design spec: `docs/superpowers/specs/2026-06-19-reader-db-resilience-design.md`.

## Global Constraints

- **Retry budget:** `maxAttempts = 3` (1 try + 2 retries), `baseDelayMs = 100`, exponential backoff `baseDelayMs * 2 ** (attempt - 1)` + jitter (`Math.random() * baseDelayMs`); both tunable via `opts`. Worst-case added latency ≤ ~500 ms (≈300 ms fixed backoff over the two waits + up to ~200 ms jitter). `opts` are validated: `maxAttempts` must be a finite integer ≥ 1 and `baseDelayMs` a finite number ≥ 0, else `withDbRetry` throws a `TypeError` (so a bad caller can never produce an unbounded loop).
- **Transient allow-list — retry ONLY (evaluated in this order):** (1) reject anything carrying a string `digest` (Next's `NEXT_REDIRECT`/`notFound` control-flow throws) — never retried; (2) `Prisma.PrismaClientKnownRequestError` strictly by code `P1001`/`P1002`/`P1017`; (3) `Prisma.PrismaClientInitializationError` strictly by `errorCode` `P1001`/`P1002` (so `P1000` auth, `P1003` no-DB, `P1010` access-denied are NOT retried); (4) only for non-Prisma-typed `Error`s, a message match against `/connection.*(closed|reset)|ECONNRESET|terminating connection|server has closed/i`. A `P2xxx` query error is decided by its code and never reaches the message fallback even if its message looks connection-like; non-`Error` values return `false`.
- **Retry applied ONLY to the reader read path** (the page-level `Promise.all`). `lib/search.ts` is untouched. No mutation path retries.
- **Reader error card copy/actions:** heading `Couldn't load this passage`; primary `Try again` button → `reset()`; secondary `Back to John 1` link → `/read?book=John&chapter=1`.
- **Root error card copy/actions:** heading `Something went wrong`; `Try again` button → `reset()`; `Home` link → `/`.
- **Test conventions:** Vitest `globals: false` — import `{ describe, it, expect, vi, beforeEach, afterEach }` from `"vitest"`. Component tests: `// @vitest-environment jsdom` as the file's first line, `@/` import alias, `afterEach(cleanup)`, NO jest-dom (plain truthy/attribute assertions only).
- **Every commit ends with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Out of scope (do not add):** `app/global-error.tsx`; applying the retry to `/search`/`/notes`/assistant; a Prisma `$extends` extension; the Neon serverless driver adapter.

---

### Task 1: `withDbRetry` helper + transient-error predicate

**Files:**
- Create: `lib/db-retry.ts`
- Test: `tests/unit/lib/db-retry.test.ts`

**Interfaces:**
- Consumes: `Prisma` from `@prisma/client` (error classes).
- Produces:
  - `export function isTransientConnectionError(err: unknown): boolean`
  - `export async function withDbRetry<T>(fn: () => Promise<T>, opts?: { maxAttempts?: number; baseDelayMs?: number }): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/db-retry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { withDbRetry, isTransientConnectionError } from "@/lib/db-retry";

function knownError(code: string, message = `error ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

function initError(errorCode: string | undefined, message = "init failure") {
  return new Prisma.PrismaClientInitializationError(message, "test", errorCode);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isTransientConnectionError", () => {
  it("is true for connection-level known-request codes", () => {
    expect(isTransientConnectionError(knownError("P1001"))).toBe(true);
    expect(isTransientConnectionError(knownError("P1002"))).toBe(true);
    expect(isTransientConnectionError(knownError("P1017"))).toBe(true);
  });

  it("is true for init errors with a transient connection code", () => {
    expect(isTransientConnectionError(initError("P1001"))).toBe(true);
    expect(isTransientConnectionError(initError("P1002"))).toBe(true);
  });

  it("is true for connection-closed/reset messages on untyped errors", () => {
    expect(isTransientConnectionError(new Error("the server has closed the connection"))).toBe(true);
    expect(isTransientConnectionError(new Error("Connection reset by peer ECONNRESET"))).toBe(true);
  });

  it("is false for non-transient init errors (P1000 auth, or no code)", () => {
    expect(isTransientConnectionError(initError("P1000", "authentication failed"))).toBe(false);
    expect(isTransientConnectionError(initError(undefined))).toBe(false);
  });

  it("decides Prisma typed errors by code, never by message", () => {
    // A query error whose message happens to look connection-like must NOT retry.
    expect(isTransientConnectionError(knownError("P2002", "connection closed"))).toBe(false);
  });

  it("never retries a digest-bearing control-flow throw, even with a matching message", () => {
    const redirect = Object.assign(new Error("connection reset during NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x;307;"
    });
    expect(isTransientConnectionError(redirect)).toBe(false);
  });

  it("is false for plain errors and non-Error values", () => {
    expect(isTransientConnectionError(new Error("some unrelated failure"))).toBe(false);
    expect(isTransientConnectionError("connection closed")).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
  });
});

describe("withDbRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient error once then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(knownError("P1017")).mockResolvedValue("recovered");
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-transient error immediately without retrying", async () => {
    const err = knownError("P2002");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts then rethrows the transient error", async () => {
    const err = knownError("P1001");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid options without calling fn (keeps the retry bounded)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withDbRetry(fn, { maxAttempts: Number.NaN })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { maxAttempts: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { maxAttempts: 0 })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { baseDelayMs: -1 })).rejects.toBeInstanceOf(TypeError);
    await expect(withDbRetry(fn, { baseDelayMs: Number.NaN })).rejects.toBeInstanceOf(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- tests/unit/lib/db-retry.test.ts`
Expected: FAIL — cannot resolve module `@/lib/db-retry`.

- [ ] **Step 3: Write the implementation**

Create `lib/db-retry.ts`:

```ts
import { Prisma } from "@prisma/client";

// Connection-level codes on a query (KnownRequestError): P1001 (can't reach
// DB), P1002 (connection timed out), P1017 (server closed the connection).
const TRANSIENT_REQUEST_CODES = new Set(["P1001", "P1002", "P1017"]);

// Connection-level codes at client init (InitializationError): P1001/P1002.
// Deliberately excludes non-retryable init failures such as P1000 (auth
// failed), P1003 (database does not exist), and P1010 (access denied).
const TRANSIENT_INIT_CODES = new Set(["P1001", "P1002"]);

// Driver/engine errors that surface as a generic (non-typed) Error when
// Neon's pooler recycles an idle connection.
const TRANSIENT_MESSAGE = /connection.*(closed|reset)|ECONNRESET|terminating connection|server has closed/i;

// Next.js control-flow throws (redirect / notFound) carry a string `digest`.
// They must propagate untouched — never retried or message-matched.
function hasStringDigest(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string"
  );
}

/**
 * Conservative allow-list, evaluated in order: (1) reject framework
 * control-flow throws; (2) Prisma typed errors are matched strictly by code,
 * so a query error (P2xxx) or auth failure (P1000) is never retried even if
 * its message looks connection-like; (3) only untyped Errors fall through to
 * the connection-drop message check. Returns true ONLY for transient
 * connection failures that are safe to retry.
 */
export function isTransientConnectionError(err: unknown): boolean {
  if (hasStringDigest(err)) return false;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_REQUEST_CODES.has(err.code);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return err.errorCode !== undefined && TRANSIENT_INIT_CODES.has(err.errorCode);
  }
  if (err instanceof Error) return TRANSIENT_MESSAGE.test(err.message);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying it on transient connection errors with bounded
 * exponential backoff + jitter. Non-transient errors and exhausted retries
 * rethrow the original error untouched. Intended for idempotent reads only.
 *
 * Invalid options throw a TypeError before `fn` runs, so a bad caller can
 * never turn the retry loop unbounded.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 100;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(`withDbRetry: maxAttempts must be an integer >= 1, got ${maxAttempts}`);
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new TypeError(`withDbRetry: baseDelayMs must be a finite number >= 0, got ${baseDelayMs}`);
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isTransientConnectionError(err)) {
        throw err;
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
      console.warn(
        `withDbRetry: transient DB error on attempt ${attempt}/${maxAttempts}; retrying in ~${Math.round(backoff)}ms`
      );
      await sleep(backoff);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- tests/unit/lib/db-retry.test.ts`
Expected: PASS — all tests in both `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add lib/db-retry.ts tests/unit/lib/db-retry.test.ts
git commit -m "feat(db): add withDbRetry for transient Neon connection errors" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wrap the reader read path in `withDbRetry`

**Files:**
- Modify: `app/read/page.tsx`

**Interfaces:**
- Consumes: `withDbRetry` from Task 1.
- Produces: nothing new (wiring only).

This task has no new unit test — it is a wiring change. The retry behavior is already proven by Task 1; correctness here is verified by the type-checker and build. (A server-component integration test would require mocking Prisma + all four search functions for negligible value.)

- [ ] **Step 1: Add the import**

In `app/read/page.tsx`, immediately after the multi-line search import that ends with `} from "@/lib/search";`, add:

```ts
import { withDbRetry } from "@/lib/db-retry";
```

- [ ] **Step 2: Wrap the four top-level read operations (Promise.all)**

Replace this exact block:

```ts
  const [books, passages, verses, neighbors] = await Promise.all([
    getAvailableReaderBooks(),
    getAvailablePassages(),
    getReaderPassage(book, chapter, userId),
    getPassageNeighbors(book, chapter)
  ]);
```

with:

```ts
  // Retry transient Neon connection drops (idle-suspend / pooler recycle) on
  // these idempotent reads before letting the page fall through to error.tsx.
  const [books, passages, verses, neighbors] = await withDbRetry(() =>
    Promise.all([
      getAvailableReaderBooks(),
      getAvailablePassages(),
      getReaderPassage(book, chapter, userId),
      getPassageNeighbors(book, chapter)
    ])
  );
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit --pretty false`
Expected: no errors.

- [ ] **Step 4: Confirm the helper tests still pass**

Run: `npm run test:unit -- tests/unit/lib/db-retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/read/page.tsx
git commit -m "feat(read): retry the reader read path on transient DB errors" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Reader error boundary `app/read/error.tsx`

**Files:**
- Create: `app/read/error.tsx`
- Test: `tests/unit/app/read-error.test.tsx`

**Interfaces:**
- Consumes: `FOCUS_RING` from `@/lib/ui/focus`; `Link` from `next/link`.
- Produces: default export `ReadError({ error, reset }: { error: Error & { digest?: string }; reset: () => void })`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/read-error.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ReadError from "@/app/read/error";

afterEach(cleanup);

describe("ReadError", () => {
  it("renders the passage error with a Back to John 1 link", () => {
    render(<ReadError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("heading", { name: /couldn't load this passage/i })).toBeTruthy();
    const link = screen.getByRole("link", { name: /back to john 1/i });
    expect(link.getAttribute("href")).toBe("/read?book=John&chapter=1");
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    render(<ReadError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- tests/unit/app/read-error.test.tsx`
Expected: FAIL — cannot resolve module `@/app/read/error`.

- [ ] **Step 3: Write the implementation**

Create `app/read/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FOCUS_RING } from "@/lib/ui/focus";

export default function ReadError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-slate-950">
        Couldn&apos;t load this passage
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        This is usually a brief hiccup — give it another try.
      </p>
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className={`rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 ${FOCUS_RING}`}
        >
          Try again
        </button>
        <Link
          href="/read?book=John&chapter=1"
          className={`rounded-md text-sm font-medium text-accent-700 hover:text-accent-800 ${FOCUS_RING}`}
        >
          Back to John 1
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- tests/unit/app/read-error.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/read/error.tsx tests/unit/app/read-error.test.tsx
git commit -m "feat(read): add on-brand error boundary for the reader" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Root error boundary `app/error.tsx`

**Files:**
- Create: `app/error.tsx`
- Test: `tests/unit/app/root-error.test.tsx`

**Interfaces:**
- Consumes: `FOCUS_RING` from `@/lib/ui/focus`; `Link` from `next/link`.
- Produces: default export `RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void })`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/root-error.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RootError from "@/app/error";

afterEach(cleanup);

describe("RootError", () => {
  it("renders the generic error with a Home link", () => {
    render(<RootError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /home/i }).getAttribute("href")).toBe("/");
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    render(<RootError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- tests/unit/app/root-error.test.tsx`
Expected: FAIL — cannot resolve module `@/app/error`.

- [ ] **Step 3: Write the implementation**

Create `app/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FOCUS_RING } from "@/lib/ui/focus";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-slate-950">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        An unexpected error occurred. Please try again.
      </p>
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className={`rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 ${FOCUS_RING}`}
        >
          Try again
        </button>
        <Link
          href="/"
          className={`rounded-md text-sm font-medium text-accent-700 hover:text-accent-800 ${FOCUS_RING}`}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- tests/unit/app/root-error.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/error.tsx tests/unit/app/root-error.test.tsx
git commit -m "feat(app): add a generic root error boundary" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Documentation — security register + PROJECT_STATE

**Files:**
- Modify: `docs/security-register.md`
- Modify: `docs/PROJECT_STATE.md`
- Check (likely no change): `README.md`

This task has no test; it ends with documentation commits required by `CLAUDE.md`.

- [ ] **Step 1: Add the security-register entry**

In `docs/security-register.md`, under the `## Open` section, immediately **before** the `## Tooling notes` heading, insert this new entry (it becomes the last row under Open):

```markdown
### Reader read-path DB retry + error boundaries (Neon transient-connection resilience)

| Field | Value |
| --- | --- |
| Severity | Low (availability / resilience hardening; not a vulnerability) |
| Change | New `lib/db-retry.ts` `withDbRetry()` wraps the reader read path (`app/read/page.tsx`'s four top-level read operations) and retries transient Neon connection errors; two React error boundaries — `app/read/error.tsx` (on-brand) and `app/error.tsx` (generic root) — render a graceful "try again" card instead of Next's default crash page. |
| Root cause | Neon serverless compute autosuspends when idle and its connection pooler recycles connections, so the first request after a quiet window can find Prisma's pooled connection already closed and throw a transient connection error (`P1001`/`P1002`/`P1017`/init error/"connection closed") even though the database is healthy. |
| Status | Accepted — bounded |
| Mitigation | Retries are bounded: `maxAttempts = 3` with exponential backoff + jitter (≤ ~500 ms worst-case added latency before giving up), and the options are validated (`maxAttempts` a finite integer ≥ 1, `baseDelayMs` finite ≥ 0, else `TypeError`), so a persistent transient error cannot loop unboundedly. `isTransientConnectionError` is a conservative allow-list evaluated in order: control-flow throws (string `digest`) are rejected first; Prisma typed errors are matched strictly by code (so `P2xxx` query errors and `P1000` auth failures are never retried, even with a connection-like message); only untyped `Error`s fall through to the connection-drop message check. The retry is applied only to the reader read path (pure idempotent reads) — no mutation path retries. No new endpoint, dependency, vendor, or trust boundary is introduced. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-06-19 (DB-resilience PR) |
| Next review | Re-check if `withDbRetry` is applied to mutation paths or other routes, or if the transient-error allow-list is widened. |
```

- [ ] **Step 2: Add the PROJECT_STATE bullet**

In `docs/PROJECT_STATE.md`, under the `### Database` section, immediately **after** the bullet that begins `- Prisma 6 over PostgreSQL.`, insert this new bullet:

```markdown
- **Connection resilience:** the reader read path (`app/read/page.tsx`) wraps its queries in `withDbRetry` (`lib/db-retry.ts`), which retries transient Neon connection errors (idle-suspend / pooler recycle) with bounded exponential backoff before failing; `app/read/error.tsx` (on-brand) and a root `app/error.tsx` render a graceful "try again" card if a render still fails.
```

- [ ] **Step 3: Check README for a resilience/error-handling section**

Run: `grep -niE "resilience|error boundary|retry|cold start" README.md`
Expected: no relevant architecture/resilience section. If a natural spot exists, add one concise sentence consistent with the surrounding prose; otherwise leave `README.md` unchanged (the default expectation).

- [ ] **Step 4: Commit**

```bash
git add docs/security-register.md docs/PROJECT_STATE.md
git commit -m "docs: record reader DB-retry resilience (security register + PROJECT_STATE)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] All five tasks committed.
- [ ] `npm run verify` is green (lint + tsc + build + coverage; the new `db-retry` and two `error.tsx` test files run as part of the unit suite).
- [ ] `docs/security-register.md` and `docs/PROJECT_STATE.md` updated; `README.md` checked.
- [ ] Whole-branch review (per subagent-driven-development) before opening the PR; user gates the merge.
