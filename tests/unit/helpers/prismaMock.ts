import { vi } from "vitest";

type DeepFn = ReturnType<typeof vi.fn>;

export function createPrismaMock() {
  const fn = () => vi.fn();
  return {
    aiSession: { findFirst: fn(), create: fn() },
    aiMessage: { create: fn() },
    token: { findMany: fn(), groupBy: fn(), count: fn() },
    verse: { findMany: fn(), findFirst: fn(), count: fn() }
  } satisfies Record<string, Record<string, DeepFn>>;
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;
