import { describe, expect, it } from "vitest";
import { normalizeDomainCode, resolveDomainFilter, domainTokenWhere } from "@/lib/search";

describe("normalizeDomainCode", () => {
  it("left-pads short domain numbers to 3 digits", () => {
    expect(normalizeDomainCode("33")).toBe("033");
    expect(normalizeDomainCode("1")).toBe("001");
    expect(normalizeDomainCode("033")).toBe("033");
  });
  it("strips non-digits", () => {
    expect(normalizeDomainCode(" 33 ")).toBe("033");
  });
  it("normalizes over-padded codes to the canonical 3 digits", () => {
    expect(normalizeDomainCode("0033")).toBe("033");
    expect(normalizeDomainCode("00001")).toBe("001");
  });
  it("collapses empty/non-digit input to 000", () => {
    expect(normalizeDomainCode("")).toBe("000");
    expect(normalizeDomainCode("abc")).toBe("000");
  });
});

describe("resolveDomainFilter", () => {
  it("applies precedence ln > subdomain > domain", () => {
    expect(resolveDomainFilter({ ln: "33.55", subdomain: "033006", domain: "33" })).toEqual({ kind: "ln", value: "33.55" });
    expect(resolveDomainFilter({ subdomain: "033006", domain: "33" })).toEqual({ kind: "subdomain", value: "033006" });
    expect(resolveDomainFilter({ domain: "33" })).toEqual({ kind: "domain", value: "033" });
  });
  it("returns null when nothing is provided", () => {
    expect(resolveDomainFilter({})).toBeNull();
    expect(resolveDomainFilter({ ln: "  ", subdomain: "", domain: "" })).toBeNull();
  });
});

describe("domainTokenWhere", () => {
  it("builds an exact louwNida filter for an ln ref", () => {
    expect(domainTokenWhere({ kind: "ln", value: "33.55" }, [])).toEqual({ louwNida: { has: "33.55" } });
  });
  it("builds an exact lnDomain filter for a subdomain", () => {
    expect(domainTokenWhere({ kind: "subdomain", value: "033006" }, [])).toEqual({ lnDomain: { has: "033006" } });
  });
  it("builds an overlap lnDomain filter for a domain (own code + children)", () => {
    expect(domainTokenWhere({ kind: "domain", value: "033" }, ["033", "033006", "033007"])).toEqual({
      lnDomain: { hasSome: ["033", "033006", "033007"] }
    });
  });
});
