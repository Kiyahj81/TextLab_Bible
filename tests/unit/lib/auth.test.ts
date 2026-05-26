import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/user", () => ({ localUserId: "local-user" }));

import { getOptionalUserId, requireUserId } from "@/lib/auth";

describe("Sprint 1 auth stub", () => {
  it("requireUserId returns the local user id", async () => {
    await expect(requireUserId()).resolves.toBe("local-user");
  });

  it("getOptionalUserId returns the local user id", async () => {
    await expect(getOptionalUserId()).resolves.toBe("local-user");
  });
});
