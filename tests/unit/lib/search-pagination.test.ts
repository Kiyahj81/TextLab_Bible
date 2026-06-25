import { describe, it, expect, vi } from "vitest";

// shared.ts imports the prisma client at module load; mock it so importing the
// pure pagination helper doesn't instantiate a real PrismaClient (no DATABASE_URL
// in the unit env).
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { normalizePagination } from "@/lib/search/shared";

describe("normalizePagination", () => {
  it("clamps a fractional page/pageSize (0 < x < 1) up to 1 instead of flooring to 0", () => {
    // Regression (#51): 0.5 passed the positivity check then floored to 0, which made
    // paginationResult's pageCount Infinity and drove LIMIT 0 queries downstream.
    expect(normalizePagination({ page: 0.5, pageSize: 0.5 })).toEqual({ page: 1, pageSize: 1 });
  });

  it("preserves existing behavior for normal, missing, invalid, and over-cap inputs", () => {
    expect(normalizePagination({ page: 2, pageSize: 50 })).toEqual({ page: 2, pageSize: 50 });
    expect(normalizePagination({})).toEqual({ page: 1, pageSize: 25 });
    expect(normalizePagination({ page: 0, pageSize: -3 })).toEqual({ page: 1, pageSize: 25 });
    expect(normalizePagination({ page: 5, pageSize: 500 })).toEqual({ page: 5, pageSize: 100 });
  });
});
