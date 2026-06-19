# Reader DB resilience — design

**Date:** 2026-06-19
**Status:** Approved
**Context:** The app runs on Neon serverless Postgres (production + local dev share the
`ep-tiny-queen` compute). Neon's compute autosuspends when idle and its connection pooler
recycles connections, so the first request after a quiet period can find the pooled
connection Prisma holds already closed. Prisma then throws a transient connection error —
even though the database is healthy milliseconds later. The DB client (`lib/db.ts`) is a
bare `PrismaClient` with no retry, and there is **no error boundary anywhere** in the app
(`app/**/error.tsx` / `global-error.tsx` do not exist — only `loading.tsx` files). So the
reader page (`app/read/page.tsx`, `force-dynamic`, which `await`s four top-level read
operations on every request — one of which, `getReaderPassage`, fans out to several more
queries) surfaces a self-healing infra hiccup as a hard full-page crash. This design adds a
small, bounded retry around the reader's read path plus graceful error boundaries so a
transient connection blip heals silently or, at worst, degrades to a calm "try again" card.

This is the pre-authorized "DB-resilience PR" (Option 1) queued after the reader effort
(Phases A–H) and the acceptance-e2e repair (PR #41).

## Decisions (made with the maintainer)

- **Retry scope — reader-only, reusable helper.** Build a generic `withDbRetry()` helper
  but apply it only to the `/read` data fetch in this PR. The helper is written so
  `/search`, `/notes`, and the assistant retrieval path can adopt it in later PRs without
  re-architecting. (Rejected: app-wide application now — larger diff/blast radius; an
  inline reader-only guard with no reusable helper — nothing reusable.)
- **Retry placement — wrap the page-level `Promise.all`.** One call site in
  `app/read/page.tsx`; `lib/search.ts` stays untouched. On a (rare) transient failure all
  four idempotent reads re-run, which is cheap. (Rejected: wrapping each of the four reader
  query functions in `lib/search.ts` — four edit sites in the search layer and nesting
  around `getReaderPassage`'s own `Promise.all`, for little gain since retries are rare.)
- **Error-boundary breadth — reader + root.** Add `app/read/error.tsx` (tailored, on-brand)
  **and** a generic `app/error.tsx` that catches crashes on every other route segment too,
  closing the app-wide gap that any route currently crashes ungracefully. (Rejected:
  reader-only — leaves `/search`/`/notes`/`/assistant` crashing to the default error page;
  root-only — reader error would look generic rather than on-brand.)
- **Reader error UX — on-brand, retry + escape link.** A calm card in the reader's
  palette/typography with a primary **Try again** action and a secondary **Back to John 1**
  link as an escape hatch if retry keeps failing.
- **Retry defaults — `maxAttempts: 3`, `baseDelayMs: 100`** (1 try + 2 retries, exponential
  backoff + jitter, ≤ ~500 ms worst-case added latency — ≈300 ms fixed backoff over the two
  waits + up to ~200 ms jitter — before giving up). Both tunable per call; options are validated
  so a bad caller can't produce an unbounded loop. Approved as the default budget.

## The problem in one paragraph

`app/read/page.tsx` awaits `Promise.all([getAvailableReaderBooks(), getAvailablePassages(),
getReaderPassage(book, chapter, userId), getPassageNeighbors(book, chapter)])` on every
request, and `getReaderPassage` fans out to three more `prisma.verse.findMany` calls. If any
of these hits a connection Neon closed during an idle/suspend window, Prisma throws and the
whole server render throws. With no `error.tsx` for the segment, Next renders its default
error page — a visible crash for an event that would succeed on an immediate retry. The fix
is a conservative retry around that read path (retrying **only** transient connection errors,
never real query failures or mutations) plus error boundaries as the graceful backstop.

## Components

### 1. `lib/db-retry.ts` (new, reusable)

```ts
export function isTransientConnectionError(err: unknown): boolean;

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<T>;
```

**`withDbRetry`** runs `fn()`. On error:
- If `isTransientConnectionError(err)` **and** attempts remain: wait
  `baseDelayMs * 2 ** (attempt - 1)` plus a small random jitter (`jitter = random * baseDelayMs`,
  so `baseDelayMs: 0` ⇒ no delay, for fast tests), then retry.
- Otherwise (non-transient, or attempts exhausted): rethrow the **original** error untouched.

Defaults: `maxAttempts = 3`, `baseDelayMs = 100`. Options are validated before `fn` runs —
`maxAttempts` must be a finite integer ≥ 1 and `baseDelayMs` a finite number ≥ 0, else it throws
a `TypeError` (this is what keeps the loop bounded: `NaN`/`Infinity` would otherwise make
`attempt >= maxAttempts` never true). Logs `console.warn` on each retry (so we can spot how often
Neon cold-starts bite) and rethrows quietly when exhausted. Uses `Math.random` for jitter and a
`setTimeout`-based sleep.

**`isTransientConnectionError`** is the crux and is exported for direct unit testing. It is a
conservative allow-list **evaluated in order**:

1. **Reject control-flow throws first** — any value carrying a string `digest` (Next's
   `NEXT_REDIRECT` / `notFound`) returns `false` immediately, before any other check, so a
   framework throw can never be retried or accidentally match the message fallback.
2. **`Prisma.PrismaClientKnownRequestError`** — `true` only when `code` is `P1001` (can't reach
   DB), `P1002` (connection timed out), or `P1017` (server closed the connection). Any other code
   (e.g. a `P2xxx` query error) returns `false` and never falls through to the message check.
3. **`Prisma.PrismaClientInitializationError`** — `true` only when `errorCode` is `P1001`/`P1002`.
   Non-connection init failures — `P1000` (auth failed), `P1003` (database does not exist),
   `P1010` (access denied), or an init error with no `errorCode` — return `false`.
4. **Reject other typed Prisma errors** — `PrismaClientValidationError` and
   `PrismaClientRustPanicError` return `false` outright, *before* the message fallback, so a
   validation/panic error whose message happens to read "connection closed" is never retried.
5. **Remaining errors → message match** against
   `/connection.*(closed|reset)|ECONNRESET|terminating connection|server has closed/i`. This is the
   only place a message is consulted, and it applies to generic engine `Error`s and to
   `PrismaClientUnknownRequestError` — how a recycled-connection drop can legitimately surface (it
   is intentionally *not* rejected in step 4). Non-`Error` values return `false`.

Matching Prisma typed errors **strictly by code** (steps 2–3) is what guarantees a query error or
auth failure is never retried even if its message looks connection-like. Prisma error classes are
reached via `import { Prisma } from "@prisma/client"` and `instanceof`.

### 2. `app/read/page.tsx` (one-line wrap)

Wrap the existing four top-level read operations (`Promise.all`) — the only change to this file:

```ts
import { withDbRetry } from "@/lib/db-retry";
// ...
const [books, passages, verses, neighbors] = await withDbRetry(() =>
  Promise.all([
    getAvailableReaderBooks(),
    getAvailablePassages(),
    getReaderPassage(book, chapter, userId),
    getPassageNeighbors(book, chapter),
  ])
);
```

The bare-URL `redirect()` runs **before** this block, so it is unaffected. (Belt-and-suspenders:
even if a `NEXT_REDIRECT` were thrown inside the wrapped fn, `isTransientConnectionError` returns
`false` for it, so it rethrows immediately.) `lib/search.ts` is untouched.

### 3. `app/read/error.tsx` (new, client component)

Next's segment error boundary. `"use client"`, default export
`function ReadError({ error, reset }: { error: Error & { digest?: string }; reset: () => void })`.
Logs `error` to the console on mount (`useEffect`). Renders inside the existing global
header/nav chrome (only the page area is replaced):

- Heading **"Couldn't load this passage"** — reader typography (`font-display`, `text-slate-950`).
- A calm line, e.g. "This is usually a brief hiccup — give it another try." (`text-slate-600`).
- Primary **Try again** button → `reset()` (accent button, reusing the reader's button styling
  + `FOCUS_RING`).
- Secondary **Back to John 1** link → `/read?book=John&chapter=1` (Next `<Link>`, text link).

### 4. `app/error.tsx` (new, client component)

Generic root segment boundary catching crashes on any non-reader route (`/search`, `/notes`,
`/assistant`, etc.). `"use client"`, same `{ error, reset }` signature, logs to console.
Renders **"Something went wrong"** + a **Try again** button (`reset()`) + a link home (`/`).
Non-branded, simple.

**Explicit non-goal:** errors thrown in the **root layout itself** (`app/layout.tsx`) are *not*
caught by `app/error.tsx` — that requires `app/global-error.tsx`, which is out of scope for this
PR and noted here so the gap is deliberate, not forgotten.

### 5. Tests

- **`tests/unit/lib/db-retry.test.ts`** (run with `{ baseDelayMs: 0 }` for speed — no fake timers):
  - retries a transient error then succeeds (fn throws a `P1017` `PrismaClientKnownRequestError`
    once, then resolves → returns the value, fn called twice);
  - rethrows immediately on a non-transient error (e.g. `P2002`) without retrying (fn called once);
  - exhausts `maxAttempts` on a persistent transient error (fn always throws `P1001` → rethrows
    after exactly `maxAttempts` calls);
  - `isTransientConnectionError` truth table: `true` for known-request `P1001`/`P1002`/`P1017`,
    init errors with `errorCode` `P1001`/`P1002`, and a `/connection closed|reset/` message on an
    untyped `Error` or a `PrismaClientUnknownRequestError`; `false` for a `P1000` (auth) init error,
    an init error with no `errorCode`, and — even with a message that *looks* connection-like — a
    `P2002` `PrismaClientKnownRequestError`, a `PrismaClientValidationError`, and a
    `PrismaClientRustPanicError` (typed errors are decided by class/code, not message); also `false`
    for a digest-bearing `NEXT_REDIRECT`-style error whose message matches, a plain `Error`, a raw
    string, and `null`.
  - `withDbRetry` rejects invalid options (`maxAttempts` `NaN`/`Infinity`/`0`; `baseDelayMs` `-1`/`NaN`)
    with a `TypeError` without calling `fn` — proving the bounded guarantee holds.
  - Construct Prisma errors via `new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion })`
    and `new Prisma.PrismaClientInitializationError(msg, clientVersion, errorCode)`.
- **Light jsdom component tests** for both boundaries (`// @vitest-environment jsdom`, `@/` alias,
  `afterEach(cleanup)` per repo convention, no jest-dom — plain assertions):
  - `app/read/error.tsx`: renders the heading + the **Back to John 1** link with the correct
    `href`, and clicking **Try again** calls the `reset` prop (`vi.fn()`).
  - `app/error.tsx`: renders **Something went wrong** and **Try again** calls `reset`.
- No acceptance-test change — the happy path is unaffected. `npm run verify` type-checks and
  builds the two new `error.tsx` files.

### 6. `docs/security-register.md` (required by CLAUDE.md)

Add one **Low-severity** availability/resilience row under `## Open`, in the file's
`Field | Value` table style, capturing:
- **Change:** `withDbRetry` retries the reader read path on transient connection errors; two
  error boundaries (`app/read/error.tsx`, `app/error.tsx`) as the graceful backstop.
- **Root cause:** Neon compute autosuspend + pooler connection recycling closes idle connections.
- **Bounded:** `maxAttempts = 3`, exponential backoff + jitter (≤ ~500 ms worst-case added
  latency), with validated options (finite `maxAttempts` ≥ 1) so the loop can never run unbounded;
  retries **only** transient connection errors (known-request `P1001`/`P1002`/`P1017`, init
  `P1001`/`P1002`, or a connection-drop message on an untyped error), **never** mutations or real
  query errors (`P2xxx`/auth `P1000` are matched strictly by code), and only on the reader read
  path. No new endpoint, vendor, or trust boundary; no unbounded retry/resource sink.
- **Status:** Accepted — bounded. **Owner:** Maintainer (kiyahj81). **Opened:** 2026-06-19.

### 7. `docs/PROJECT_STATE.md` / README

- **PROJECT_STATE:** one bullet noting the reader read-path retry (`withDbRetry`) + the two
  error boundaries.
- **README:** update only if there is a natural resilience/architecture spot; likely no change.

## Non-goals (deferred)

- A Prisma `$extends` client extension that transparently auto-retries **every** query app-wide
  (the elegant long-term direction, but inherently app-wide and requires care for mutations).
- Applying `withDbRetry` to `/search`, `/notes`, or the assistant retrieval path (the helper is
  built so they can adopt it later).
- `app/global-error.tsx` for errors thrown in the root layout itself.
- Swapping to Neon's serverless driver adapter (`@prisma/adapter-neon`).

## Acceptance criteria

- `withDbRetry` retries transient connection errors up to the configured budget and rethrows all
  other errors immediately, proven by `tests/unit/lib/db-retry.test.ts`.
- `/read` no longer crashes the page on a single transient connection error (the retry absorbs it);
  if retries are exhausted (or any other render error occurs), `app/read/error.tsx` renders the
  on-brand card with a working **Try again** and **Back to John 1**.
- Any other route that throws renders `app/error.tsx` instead of the default error page.
- `npm run verify` is green (lint + tsc + build + unit tests). `docs/security-register.md` and
  `docs/PROJECT_STATE.md` updated.
