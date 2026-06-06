import { describe, expect, it } from "vitest";
import { flattenLouwNidaDomains } from "@/lib/louwNida";

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
