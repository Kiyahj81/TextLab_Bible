// Returns `raw` only if it is a safe same-origin relative path, else `fallback`.
//
// A crafted ?callbackUrl= must never bounce a user to an external host after
// login. Beyond the obvious protocol-relative "//" form, browsers normalize
// backslashes to forward slashes, so "/\evil.com" navigates to evil.com — any
// backslash is rejected.
export function safeInternalPath(raw: unknown, fallback = "/read"): string {
  if (typeof raw !== "string") return fallback;

  // Fully decode (bounded) before validating. Percent-encoded separators such
  // as %5C (backslash) or %2F (slash) survive a single decode — e.g. Next
  // decodes ?callbackUrl=/%255Cevil.com to "/%5Cevil.com", which has no literal
  // backslash — but a browser decodes %5C -> \ -> / when navigating, yielding
  // //evil.com. Validate the worst-case fully-decoded form; return the original.
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (next === decoded) break;
    decoded = next;
  }

  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//")) return fallback;
  if (decoded.includes("\\")) return fallback;
  return raw;
}
