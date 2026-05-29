// Returns `raw` only if it is a safe same-origin relative path, else `fallback`.
//
// A crafted ?callbackUrl= must never bounce a user to an external host after
// login. Beyond the obvious protocol-relative "//" form, browsers normalize
// backslashes to forward slashes, so "/\evil.com" navigates to evil.com — any
// backslash is rejected.
export function safeInternalPath(raw: unknown, fallback = "/read"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  return raw;
}
