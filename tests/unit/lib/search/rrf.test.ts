import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, type RankedRef } from "@/lib/search/rrf";

const ref = (reference: string): RankedRef => ({ reference, corpus: "WEB", text: reference });

describe("reciprocalRankFusion", () => {
  it("returns [] for no lists and for empty lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("ranks a reference appearing in both lists above singletons", () => {
    const a = [ref("John 1:1"), ref("John 1:2")];
    const b = [ref("John 3:16"), ref("John 1:1")];
    const fused = reciprocalRankFusion([a, b]);
    expect(fused[0].reference).toBe("John 1:1"); // in both lists → highest fused score
  });

  it("dedupes by reference and keeps first-seen metadata", () => {
    const a = [{ reference: "John 1:1", corpus: "WEB", text: "first" }];
    const b = [{ reference: "John 1:1", corpus: "WEB", text: "second" }];
    const fused = reciprocalRankFusion([a, b]);
    expect(fused).toHaveLength(1);
    expect(fused[0].text).toBe("first");
  });

  it("preserves single-list order", () => {
    const a = [ref("A 1:1"), ref("A 1:2"), ref("A 1:3")];
    expect(reciprocalRankFusion([a]).map((r) => r.reference)).toEqual(["A 1:1", "A 1:2", "A 1:3"]);
  });
});
