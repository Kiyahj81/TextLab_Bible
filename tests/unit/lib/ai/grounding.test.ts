import { describe, expect, it, vi, beforeEach } from "vitest";

const { getPassage } = vi.hoisted(() => ({ getPassage: vi.fn() }));
vi.mock("@/lib/search", () => ({ getPassage }));

import { verifyGrounding, type GroundingClaim } from "@/lib/ai/grounding";

// getPassage returns SBLGNT/WEB verse text keyed by corpus for these tests.
function mockVerses(map: Record<string, Record<string, string>>) {
  getPassage.mockImplementation(async (args: { corpus: string; book: string; chapter: number; verseStart: number; verseEnd?: number }) => {
    const key = `${args.book} ${args.chapter}:${args.verseStart}`;
    const text = map[args.corpus]?.[key];
    return {
      corpus: args.corpus,
      references: text ? [{ book: args.book, chapter: args.chapter, verse: args.verseStart, reference: key, text }] : []
    };
  });
}

function claim(partial: Partial<GroundingClaim>): GroundingClaim {
  return { reference: "John 1:1", greekQuote: null, gloss: null, englishQuote: null, ...partial };
}

beforeEach(() => { getPassage.mockReset(); });

describe("verifyGrounding", () => {
  it("verifies an exact Greek substring quote", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ" })]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].status).toBe("verified");
    expect(report.verdicts[0].matchScore).toBe(1);
  });

  it("verifies a Greek quote despite diacritic noise", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "εν αρχη" })]);
    expect(report.grounded).toBe(true);
  });

  it("fails a Greek quote not present in the verse", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: "πῦρ καὶ θεῖον" })]);
    expect(report.grounded).toBe(false);
    expect(report.verdicts[0].status).toBe("quote-mismatch");
  });

  it("verifies an ellipsis-joined quote whose fragments are all in the verse", async () => {
    // The model often summarizes several non-adjacent occurrences in one claim,
    // joining them with an ellipsis. Each fragment is a real substring even
    // though the spliced whole is not — it must still verify.
    mockVerses({
      SBLGNT: { "Rom 7:25": "ἄρα οὖν αὐτὸς ἐγὼ τῷ μὲν νοῒ δουλεύω νόμῳ θεοῦ τῇ δὲ σαρκὶ νόμῳ ἁμαρτίας" }
    });
    const ellipsis = await verifyGrounding([
      claim({ reference: "Rom 7:25", greekQuote: "νόμῳ θεοῦ … νόμῳ ἁμαρτίας" })
    ]);
    expect(ellipsis.grounded).toBe(true);
    expect(ellipsis.verdicts[0].status).toBe("verified");

    const dots = await verifyGrounding([
      claim({ reference: "Rom 7:25", greekQuote: "νόμῳ θεοῦ ... νόμῳ ἁμαρτίας" })
    ]);
    expect(dots.grounded).toBe(true);
  });

  it("fails an ellipsis-joined quote when any fragment is absent from the verse", async () => {
    mockVerses({
      SBLGNT: { "Rom 7:25": "ἄρα οὖν αὐτὸς ἐγὼ τῷ μὲν νοῒ δουλεύω νόμῳ θεοῦ τῇ δὲ σαρκὶ νόμῳ ἁμαρτίας" }
    });
    const report = await verifyGrounding([
      claim({ reference: "Rom 7:25", greekQuote: "νόμῳ θεοῦ … πῦρ καὶ θεῖον" })
    ]);
    expect(report.grounded).toBe(false);
    expect(report.verdicts[0].status).toBe("quote-mismatch");
  });

  it("fails when the reference resolves to no SBL verse", async () => {
    mockVerses({ SBLGNT: {} });
    const report = await verifyGrounding([claim({ reference: "John 99:99", greekQuote: "x" })]);
    expect(report.verdicts[0].status).toBe("reference-not-found");
    expect(report.grounded).toBe(false);
  });

  it("fails an unparseable reference string", async () => {
    mockVerses({ SBLGNT: {} });
    const report = await verifyGrounding([claim({ reference: "the prologue" })]);
    expect(report.verdicts[0].status).toBe("reference-not-found");
  });

  it("verifies a reference-only claim (no greekQuote) when the verse exists", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    const report = await verifyGrounding([claim({ greekQuote: null })]);
    expect(report.verdicts[0].status).toBe("verified");
  });

  it("strips a mismatched WEB aid with a caveat but does NOT refuse", async () => {
    mockVerses({
      SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" },
      WEB: { "John 1:1": "In the beginning was the Word" }
    });
    const report = await verifyGrounding([
      claim({ greekQuote: "ἐν ἀρχῇ", englishQuote: "totally different sentence here" })
    ]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].status).toBe("verified");
    expect(report.verdicts[0].alignmentCaveat).toBeDefined();
  });

  it("adds a caveat when WEB has no verse at the SBL reference", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" }, WEB: {} });
    const report = await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ", englishQuote: "anything" })]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts[0].alignmentCaveat).toBeDefined();
  });

  it("dedupes repeated references to a single DB lookup", async () => {
    mockVerses({ SBLGNT: { "John 1:1": "ἐν ἀρχῇ ἦν ὁ λόγος" } });
    await verifyGrounding([claim({ greekQuote: "ἐν ἀρχῇ" }), claim({ greekQuote: "ὁ λόγος" })]);
    expect(getPassage).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the DB lookup throws (infra failure surfaces)", async () => {
    getPassage.mockRejectedValue(new Error("db connection lost"));
    await expect(verifyGrounding([claim({ greekQuote: "x" })])).rejects.toThrow("db connection lost");
  });

  it("treats an empty claims array as grounded (nothing to verify)", async () => {
    mockVerses({ SBLGNT: {} });
    const report = await verifyGrounding([]);
    expect(report.grounded).toBe(true);
    expect(report.verdicts).toEqual([]);
  });
});
