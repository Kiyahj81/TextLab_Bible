import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { signInCallback } from "@/lib/auth-callbacks";

const ORIGINAL = process.env.GITHUB_ALLOWLIST;

function githubAccount(providerAccountId: string) {
  return { provider: "github", providerAccountId };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GITHUB_ALLOWLIST;
  else process.env.GITHUB_ALLOWLIST = ORIGINAL;
});

describe("signInCallback — GitHub allowlist", () => {
  it("allows a GitHub account whose id is on the allowlist", async () => {
    process.env.GITHUB_ALLOWLIST = "255756444";
    await expect(signInCallback({ account: githubAccount("255756444") })).resolves.toBe(true);
  });

  it("denies a GitHub account whose id is not on the allowlist", async () => {
    process.env.GITHUB_ALLOWLIST = "255756444";
    await expect(signInCallback({ account: githubAccount("999999999") })).resolves.toBe(false);
  });

  it("denies all GitHub sign-ins when the allowlist is unset (fail-closed)", async () => {
    delete process.env.GITHUB_ALLOWLIST;
    await expect(signInCallback({ account: githubAccount("255756444") })).resolves.toBe(false);
  });

  it("denies all GitHub sign-ins when the allowlist is empty/whitespace (fail-closed)", async () => {
    process.env.GITHUB_ALLOWLIST = "   ,  ";
    await expect(signInCallback({ account: githubAccount("255756444") })).resolves.toBe(false);
  });

  it("matches ids in a multi-entry list and tolerates surrounding whitespace", async () => {
    process.env.GITHUB_ALLOWLIST = " 111 , 255756444 ,333 ";
    await expect(signInCallback({ account: githubAccount("255756444") })).resolves.toBe(true);
    await expect(signInCallback({ account: githubAccount("333") })).resolves.toBe(true);
    await expect(signInCallback({ account: githubAccount("222") })).resolves.toBe(false);
  });

  it("does not gate non-GitHub providers (e.g. the dev credentials provider)", async () => {
    delete process.env.GITHUB_ALLOWLIST; // even with no allowlist, credentials pass through
    await expect(
      signInCallback({ account: { provider: "credentials", providerAccountId: "local-user" } })
    ).resolves.toBe(true);
  });

  it("denies a GitHub account with a missing providerAccountId", async () => {
    process.env.GITHUB_ALLOWLIST = "255756444";
    await expect(
      signInCallback({ account: { provider: "github", providerAccountId: undefined } })
    ).resolves.toBe(false);
  });
});
