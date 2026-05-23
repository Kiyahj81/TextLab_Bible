import { describe, expect, it } from "vitest";
import { parsePositiveInt } from "@/lib/params";

describe("parsePositiveInt", () => {
  it("returns undefined for missing input", () => {
    expect(parsePositiveInt(undefined)).toBeUndefined();
    expect(parsePositiveInt(null)).toBeUndefined();
    expect(parsePositiveInt("")).toBeUndefined();
  });

  it("returns undefined for non-numeric input", () => {
    expect(parsePositiveInt("abc")).toBeUndefined();
    expect(parsePositiveInt("1.5")).toBeUndefined();
    expect(parsePositiveInt("NaN")).toBeUndefined();
  });

  it("returns undefined for zero and negatives", () => {
    expect(parsePositiveInt("0")).toBeUndefined();
    expect(parsePositiveInt("-3")).toBeUndefined();
  });

  it("parses positive integers", () => {
    expect(parsePositiveInt("1")).toBe(1);
    expect(parsePositiveInt("42")).toBe(42);
  });

  it("uses the first entry when given an array", () => {
    expect(parsePositiveInt(["7", "8"])).toBe(7);
    expect(parsePositiveInt(["bad", "1"])).toBeUndefined();
  });
});
