import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http/validation";

export type OriginCheck = { ok: true } | { ok: false; response: NextResponse };

// Same-origin gate for cookie-authenticated mutation routes. The browser
// always sends Origin on POST/PATCH/DELETE — a missing Origin means the
// request is not from a browser (curl, server-to-server), which cannot
// silently carry a victim's session cookie in a CSRF attack and is
// therefore allowed through. When Origin is present it must match the
// request Host or the configured AUTH_URL.
export function assertSameOrigin(request: Request): OriginCheck {
  const origin = request.headers.get("origin");
  if (!origin) return { ok: true };

  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return reject();
  }

  for (const expected of expectedOrigins(request)) {
    if (expected.origin === candidate.origin) return { ok: true };
  }

  return reject();
}

function expectedOrigins(request: Request): URL[] {
  const out: URL[] = [];

  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    try {
      out.push(new URL(`${proto}://${host}`));
    } catch {
      // Ignore malformed host headers; AUTH_URL fallback may still match.
    }
  }

  const configured = process.env.AUTH_URL || process.env.APP_URL;
  if (configured) {
    try {
      out.push(new URL(configured));
    } catch {
      // Ignore malformed env value; host-derived origin may still match.
    }
  }

  return out;
}

function reject(): OriginCheck {
  return { ok: false, response: jsonError("Cross-origin request rejected.", 403) };
}
