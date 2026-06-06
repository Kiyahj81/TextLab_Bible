import { describe, expect, it } from "vitest";
import { flattenLouwNidaDomains, resolveTokenDomains } from "@/lib/louwNida";

describe("flattenLouwNidaDomains", () => {
  it("flattens nested domain/subdomain nodes with derived level and parentCode", () => {
    const json = [
      {
        Code: "033",
        Level: 1,
        SemanticDomainLocalizations: [
          { LanguageCode: "en", Label: "Communication" },
          { LanguageCode: "fr", Label: "Communication (fr)" }
        ],
        Entries: [
          {
            Code: "033006",
            Level: 2,
            SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "Speak, Talk" }],
            Entries: []
          }
        ]
      }
    ];

    const rows = flattenLouwNidaDomains(json);
    expect(rows).toContainEqual({ code: "033", level: 1, label: "Communication", parentCode: null });
    expect(rows).toContainEqual({ code: "033006", level: 2, label: "Speak, Talk", parentCode: "033" });
  });

  it("picks the English localization and dedupes repeated codes", () => {
    const json = [
      { Code: "001", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "A" }] },
      { Code: "001", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "A-dup" }] }
    ];
    const rows = flattenLouwNidaDomains(json);
    expect(rows.filter((r) => r.code === "001")).toHaveLength(1);
  });

  it("ignores nodes without a code or without an English label", () => {
    const json = [
      { Code: "", SemanticDomainLocalizations: [{ LanguageCode: "en", Label: "skip" }] },
      { Code: "050", SemanticDomainLocalizations: [{ LanguageCode: "fr", Label: "only-fr" }] }
    ];
    expect(flattenLouwNidaDomains(json)).toHaveLength(0);
  });
});

describe("resolveTokenDomains", () => {
  const labels = new Map<string, string>([
    ["033", "Communication"],
    ["033006", "Speak, Talk"],
    ["010", "Geographical Objects"]
  ]);

  it("pairs each ln ref with its subdomain and parent domain label", () => {
    const senses = resolveTokenDomains(["33.38"], ["033006"], labels);
    expect(senses).toEqual([
      { ref: "33.38", domainCode: "033006", domainLabel: "Communication", subdomainLabel: "Speak, Talk" }
    ]);
  });

  it("handles multi-sense tokens by index alignment", () => {
    const senses = resolveTokenDomains(["10.24", "33.19"], ["010002", "033006"], labels);
    expect(senses).toHaveLength(2);
    expect(senses[1]).toMatchObject({ ref: "33.19", domainLabel: "Communication", subdomainLabel: "Speak, Talk" });
    expect(senses[0]).toMatchObject({ ref: "10.24", domainLabel: "Geographical Objects", subdomainLabel: null });
  });

  it("tolerates missing labels and length mismatches", () => {
    const senses = resolveTokenDomains([], ["099999"], labels);
    expect(senses).toEqual([
      { ref: null, domainCode: "099999", domainLabel: null, subdomainLabel: null }
    ]);
  });

  it("returns an empty array when the token has no domain codes", () => {
    expect(resolveTokenDomains([], [], labels)).toEqual([]);
  });

  it("attaches all ln refs to a single domain code (one MARBLE code → several LN refs)", () => {
    // Real MACULA rows like `domain=033006 ln=33.55 33.56` are common: the columns
    // have different cardinalities, so a single domain code keeps all of its refs
    // rather than dropping the extras.
    const senses = resolveTokenDomains(["33.55", "33.56"], ["033006"], labels);
    expect(senses).toEqual([
      {
        ref: "33.55, 33.56",
        domainCode: "033006",
        domainLabel: "Communication",
        subdomainLabel: "Speak, Talk"
      }
    ]);
  });
});
