// tests/unit/eval/report.test.ts
import { describe, expect, it } from "vitest";
import { renderHtmlReport, renderJsonReport } from "@/eval/report";
import type { RunResult } from "@/eval/runner";

const sample: RunResult[] = [
  {
    item: { id: "john-3-16-exact", question: "What does John 3:16 say?", queryType: "exact-verse", goldenReferences: ["John 3:16"] },
    mode: "hybrid",
    retrievedReferences: ["John 3:16", "John 3:17"],
    hits: [
      { reference: "John 3:16", corpus: "SBLGNT", toolName: "getPassage" },
      { reference: "John 3:17", corpus: "SBLGNT", toolName: "searchSemantic" }
    ],
    recall: 1,
    precision: 0.5,
    citationsResolve: true,
    lemmaRequired: false,
    lemmaFound: false,
    rerankStatus: "ok",
    rerankCandidateCount: 12,
    synthesisStatus: "ran",
    synthesisModel: "gpt-5-chat-latest",
    judgeStatus: "ran",
    judgeModel: "anthropic/claude-sonnet-5",
    faithfulness: { score: 1, claims: [{ statement: "God so loved the world", supported: true, reason: "matches John 3:16" }], model: "anthropic/claude-sonnet-5" }
  }
];

describe("renderJsonReport", () => {
  it("round-trips results plus an aggregate summary", () => {
    const json = JSON.parse(renderJsonReport(sample));
    expect(json.summary.meanRecall).toBe(1);
    expect(json.summary.citationResolvability).toBe(1);
    expect(json.results).toHaveLength(1);
  });
});

describe("renderHtmlReport", () => {
  it("produces a self-contained HTML doc with the question, refs, and rerank status", () => {
    const html = renderHtmlReport(sample);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("What does John 3:16 say?");
    expect(html).toContain("John 3:16");
    expect(html).toContain("#365f7e");
    expect(html).toContain("ok");           // rerank status surfaced
    expect(html).toContain("12");           // rerank candidate count surfaced
    expect(html).toContain("gpt-5-chat-latest"); // synthesis model surfaced
    expect(html).not.toContain("<script src");
  });
  it("escapes HTML-special characters in question text", () => {
    const html = renderHtmlReport([{ ...sample[0], item: { ...sample[0].item, question: "love & <faith>" } }]);
    expect(html).toContain("love &amp; &lt;faith&gt;");
  });
  it("surfaces an explicit judge error instead of labeling it 'off'", () => {
    const errored: RunResult[] = [{
      ...sample[0], faithfulness: null, judgeStatus: "error",
      judgeModel: "anthropic/claude-sonnet-5", judgeError: "model not found"
    }];
    const html = renderHtmlReport(errored);
    expect(html).toContain("error");
    expect(html).toContain("model not found");
    expect(html).not.toContain("off (no AI_GATEWAY_API_KEY)"); // not mislabeled as missing key
  });
});
