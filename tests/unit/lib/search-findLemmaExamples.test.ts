import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    token: { findMany: vi.fn() },
    verse: { findMany: vi.fn() }
  }
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { findLemmaExamples } from "@/lib/search";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.token.findMany.mockResolvedValue([]);
  prismaMock.verse.findMany.mockResolvedValue([]);
});

describe("findLemmaExamples DB bound", () => {
  it("caps token.findMany take at lemmas.length * perLemma + 50", async () => {
    await findLemmaExamples({ lemmas: ["a", "b", "c"], perLemma: 5 });

    expect(prismaMock.token.findMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.token.findMany.mock.calls[0][0];
    expect(args.take).toBe(3 * 5 + 50);
  });
});
