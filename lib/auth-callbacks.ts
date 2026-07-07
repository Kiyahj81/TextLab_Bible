import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/db";

// Lives outside auth.ts so the callback and event can be tested without
// triggering NextAuth's runtime initialization (which depends on Next's
// bundler resolving `next/server`).

let warnedEmptyAllowlist = false;

// Parse GITHUB_ALLOWLIST at call time (not module load) so runtime env and
// tests both see the current value. Comma-separated GitHub numeric account
// ids; surrounding whitespace and empty entries are ignored.
function parseGithubAllowlist(): Set<string> {
  return new Set(
    (process.env.GITHUB_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

// Authorization gate for the GitHub OAuth provider. Only accounts whose
// numeric id is on GITHUB_ALLOWLIST may sign in. Fail-closed: an unset or
// empty allowlist denies every GitHub sign-in, so a missing env var can
// never silently open the app. Other providers (the dev-only credentials
// provider) are not gated. Returning false makes Auth.js redirect to
// /signin?error=AccessDenied.
export async function signInCallback({
  account
}: {
  account?: { provider?: string | null; providerAccountId?: string | null } | null;
}): Promise<boolean> {
  if (!account || account.provider !== "github") return true;

  const allowlist = parseGithubAllowlist();
  if (allowlist.size === 0) {
    if (!warnedEmptyAllowlist) {
      console.warn(
        "[auth] GITHUB_ALLOWLIST is unset or empty — denying all GitHub sign-ins (fail-closed)."
      );
      warnedEmptyAllowlist = true;
    }
    return false;
  }

  return account.providerAccountId != null && allowlist.has(account.providerAccountId);
}

export async function jwtCallback({
  token,
  user
}: {
  token: JWT;
  user?: { id?: string } | null;
}): Promise<JWT> {
  if (user && user.id) {
    token.userId = user.id;
  }
  return token;
}

export async function sessionCallback({
  session,
  token
}: {
  session: Session;
  token: JWT;
}): Promise<Session> {
  if (!token.userId || !session.user) return session;

  const userId = String(token.userId);
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionsValidFrom: true }
  });

  // Compare JWT issued-at (seconds) to the revocation watermark (ms).
  // Tokens issued at or before the watermark were active during a prior
  // sign-out and must not be honored.
  if (dbUser?.sessionsValidFrom) {
    const iatMs = (token.iat ?? 0) * 1000;
    if (iatMs <= dbUser.sessionsValidFrom.getTime()) {
      return session;
    }
  }

  session.user.id = userId;
  return session;
}

// JWT strategy: signOut receives { token }. We bump sessionsValidFrom so
// any replayed copy of the same JWT is rejected by sessionCallback on the
// next request.
export async function signOutEvent(
  message: { token?: JWT | null } | { session?: unknown }
): Promise<void> {
  const token = "token" in message ? message.token : null;
  const userId = token && typeof token.userId === "string" ? token.userId : null;
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { sessionsValidFrom: new Date() }
  });
}
