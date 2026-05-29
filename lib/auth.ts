import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { jsonError } from "@/lib/http/validation";

export type AuthSuccess = { ok: true; userId: string };
export type AuthFailure = { ok: false; response: NextResponse };
export type AuthResult = AuthSuccess | AuthFailure;

// For API route handlers. Discriminated result mirrors readJsonLimited /
// validateBody so handlers compose cleanly.
export async function requireAuth(): Promise<AuthResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, response: jsonError("Unauthenticated.", 401) };
  }
  return { ok: true, userId };
}

// For server components / pages. Redirects to sign-in when no session;
// never returns in that case.
export async function requirePageAuth(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    // middleware.ts injects x-pathname so we can return the user to the page
    // they requested after sign-in. safeInternalPath re-validates it there.
    const path = (await headers()).get("x-pathname");
    redirect(path && path !== "/" ? `/signin?callbackUrl=${encodeURIComponent(path)}` : "/signin");
  }
  return userId;
}

// Read-only accessor. Returns null when there is no session; never
// throws and never redirects. Use for code paths where anonymous access
// is intentionally allowed.
export async function getOptionalUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
