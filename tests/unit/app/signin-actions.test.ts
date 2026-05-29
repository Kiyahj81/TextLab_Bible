import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthError } from "next-auth";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("@/auth", () => ({ signIn: signInMock }));

import { devSignIn, githubSignIn } from "@/app/signin/actions";

function makeAuthError(type: string): Error {
  const err = Object.create(AuthError.prototype) as Error & { type: string };
  err.message = type;
  err.type = type;
  return err;
}

beforeEach(() => {
  // mockReset (not just clearAllMocks) so a rejected value set in one test does
  // not leak its implementation into the next.
  signInMock.mockReset();
});

describe("devSignIn", () => {
  it("returns 'Invalid credentials.' when AuthError of type CredentialsSignin", async () => {
    signInMock.mockRejectedValue(makeAuthError("CredentialsSignin"));
    const fd = new FormData();
    fd.append("email", "bad");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Invalid credentials.");
  });

  it("returns generic message for other AuthError types", async () => {
    signInMock.mockRejectedValue(makeAuthError("Configuration"));
    const fd = new FormData();
    fd.append("email", "x@y");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Something went wrong signing you in.");
  });

  it("re-throws non-AuthError exceptions (incl. NEXT_REDIRECT)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/read;307;" });
    signInMock.mockRejectedValue(redirectErr);
    const fd = new FormData();
    fd.append("email", "x@y");
    await expect(devSignIn(null, fd)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("returns 'Email is required.' before calling signIn when email missing", async () => {
    const fd = new FormData();
    fd.append("email", "");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Email is required.");
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe("githubSignIn", () => {
  it("passes a valid internal callbackUrl through as redirectTo", async () => {
    await githubSignIn("/notes");
    expect(signInMock).toHaveBeenCalledWith("github", { redirectTo: "/notes" });
  });

  it("rejects an external/backslash callbackUrl before calling signIn", async () => {
    await githubSignIn("/\\evil.example.com");
    expect(signInMock).toHaveBeenCalledWith("github", { redirectTo: "/read" });
  });

  it("falls back to /read when no callbackUrl is provided", async () => {
    await githubSignIn();
    expect(signInMock).toHaveBeenCalledWith("github", { redirectTo: "/read" });
  });
});
