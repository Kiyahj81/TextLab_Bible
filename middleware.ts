import { NextResponse, type NextRequest } from "next/server";

// Inject the requested path as a header so server components (notably
// requirePageAuth) can build a post-login callbackUrl back to the page the
// user was trying to reach. This is the only reliable way to read the current
// pathname in an App Router server component.
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Skip API routes, Next internals, the auth callback, and the sign-in page
  // itself (no point bouncing /signin back to /signin).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|signin).*)"]
};
