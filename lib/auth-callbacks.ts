import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/db";

// Lives outside auth.ts so the callback and event can be tested without
// triggering NextAuth's runtime initialization (which depends on Next's
// bundler resolving `next/server`).

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
