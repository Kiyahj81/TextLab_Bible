import { Prisma } from "@prisma/client";

// Connection-level codes on a query (KnownRequestError): P1001 (can't reach
// DB), P1002 (connection timed out), P1017 (server closed the connection).
const TRANSIENT_REQUEST_CODES = new Set(["P1001", "P1002", "P1017"]);

// Connection-level codes at client init (InitializationError): P1001/P1002.
// Deliberately excludes non-retryable init failures such as P1000 (auth
// failed), P1003 (database does not exist), and P1010 (access denied).
const TRANSIENT_INIT_CODES = new Set(["P1001", "P1002"]);

// Driver/engine errors that surface as a generic (non-typed) Error when
// Neon's pooler recycles an idle connection. Includes "Connection terminated
// unexpectedly" (the node-postgres pool-drop message) for any path that uses a
// JS driver adapter.
const TRANSIENT_MESSAGE = /connection.*(closed|reset|terminated)|ECONNRESET|terminating connection|server has closed/i;

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
 * its message looks connection-like; (3) other typed Prisma errors
 * (validation, rust-panic) are rejected outright; (4) the remaining errors —
 * generic Errors and PrismaClientUnknownRequestError (how a recycled
 * connection can surface) — fall through to the connection-drop message check.
 * Returns true ONLY for transient connection failures that are safe to retry.
 */
export function isTransientConnectionError(err: unknown): boolean {
  if (hasStringDigest(err)) return false;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_REQUEST_CODES.has(err.code);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return err.errorCode !== undefined && TRANSIENT_INIT_CODES.has(err.errorCode);
  }
  // Other typed Prisma errors are never a connection drop — reject them before
  // the message fallback so a validation/panic message can't slip through.
  // PrismaClientUnknownRequestError is intentionally NOT rejected: a recycled
  // connection can surface as one, so it stays eligible for the message check.
  if (
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return false;
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
