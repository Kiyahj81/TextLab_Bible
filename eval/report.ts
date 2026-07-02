// eval/report.ts
import { aggregate, type Aggregate } from "@/eval/metrics";
import { GLOBAL_GATES, TYPE_GATES } from "@/eval/thresholds";
import { canonicalizeReference } from "@/eval/references";
import type { QueryType } from "@/eval/dataset/schema";
import type { RunResult, SemanticPassTrace } from "@/eval/runner";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const mean = (nums: number[]) => (nums.length === 0 ? 1 : nums.reduce((a, b) => a + b, 0) / nums.length);

function summaryOf(results: RunResult[]): Aggregate {
  return aggregate(
    results.map((r) => ({
      recall: r.recall,
      precision: r.precision,
      citationsResolve: r.citationsResolve,
      lemmaRequired: r.lemmaRequired,
      lemmaFound: r.lemmaFound
    }))
  );
}

function meanFaithfulness(results: RunResult[]): number | null {
  const scored = results.filter((r) => r.faithfulness).map((r) => r.faithfulness!.score);
  return scored.length === 0 ? null : scored.reduce((a, b) => a + b, 0) / scored.length;
}

// Deep mode runs TWO semantic passes (scoped + corpus-wide) — each RunResult
// already carries its own `semanticPasses` array (see eval/runner.ts), but that's
// buried one item at a time inside `results`. Surface it as its own top-level
// section too, so a reviewer scanning the JSON report can see at a glance which
// items went deep and whether both passes (not just the first) actually ran.
function semanticPassSummary(
  results: RunResult[]
): Array<{ id: string; deep: boolean; passes: SemanticPassTrace[] }> {
  return results
    .filter((r) => r.semanticPasses.length > 0)
    .map((r) => ({ id: r.item.id, deep: r.deep, passes: r.semanticPasses }));
}

export function renderJsonReport(results: RunResult[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      gates: { global: GLOBAL_GATES, byType: TYPE_GATES },
      summary: summaryOf(results),
      meanFaithfulness: meanFaithfulness(results),
      semanticPasses: semanticPassSummary(results),
      results
    },
    null,
    2
  );
}

function badge(pass: boolean): string {
  return pass ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
}

// Type-aware per-item pass: global hard gates always apply; recall/precision only
// where gated for the item's query type.
function itemGatePass(result: RunResult): boolean {
  if (!result.citationsResolve) return false;
  if (result.lemmaRequired && !result.lemmaFound) return false;
  const gate = TYPE_GATES[result.item.queryType as QueryType];
  if (gate.recall !== undefined && result.recall < gate.recall) return false;
  if (gate.precision !== undefined && result.precision < gate.precision) return false;
  return true;
}

function refDiff(result: RunResult): string {
  const golden = new Set(result.item.goldenReferences.map((r) => canonicalizeReference(r) ?? r));
  const retrieved = new Set(result.retrievedReferences.map((r) => canonicalizeReference(r) ?? r));
  const goldenRows = [...golden].map((ref) => `<li class="${retrieved.has(ref) ? "hit" : "miss"}">${retrieved.has(ref) ? "✓" : "✗"} ${esc(ref)}</li>`).join("");
  const retrievedRows = [...retrieved].map((ref) => `<li class="${golden.has(ref) ? "hit" : "extra"}">${golden.has(ref) ? "✓" : "•"} ${esc(ref)}</li>`).join("");
  return `<div class="refcols"><div><h4>Golden (${golden.size})</h4><ul>${goldenRows}</ul></div><div><h4>Retrieved (${retrieved.size})</h4><ul>${retrievedRows}</ul></div></div>`;
}

function traceRows(result: RunResult): string {
  if (result.hits.length === 0) return `<p class="muted">No citations retrieved.</p>`;
  const rows = result.hits.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.reference)}</td><td>${esc(h.corpus)}</td><td>${esc(h.toolName ?? "")}</td></tr>`).join("");
  const rerank = result.rerankStatus
    ? `<p class="muted">rerank: ${esc(result.rerankStatus)}${result.rerankCandidateCount === null ? "" : ` (${result.rerankCandidateCount} candidates)`}</p>`
    : "";
  return `<table class="trace"><thead><tr><th>#</th><th>Reference</th><th>Corpus</th><th>Tool</th></tr></thead><tbody>${rows}</tbody></table>${rerank}`;
}

function coverageBlock(result: RunResult): string {
  if (!result.lemmaRequired) return "";
  const lemma = esc(result.item.mustContainLemma ?? "");
  return `<p class="${result.lemmaFound ? "hit" : "miss"}">${result.lemmaFound ? "✓" : "✗"} required lemma ${lemma}</p>`;
}

function faithfulnessBlock(result: RunResult): string {
  if (result.faithfulness) {
    const claims = result.faithfulness.claims.map((c) => `<li class="${c.supported ? "hit" : "miss"}">${c.supported ? "✓" : "✗"} ${esc(c.statement)} <span class="muted">— ${esc(c.reason)}</span></li>`).join("");
    return `<div class="faith"><h4>Faithfulness ${result.faithfulness.score.toFixed(2)} <span class="muted">(${esc(result.faithfulness.model)})</span></h4><ul>${claims}</ul></div>`;
  }
  // No score — show WHY explicitly (Finding 3), never silently blank.
  if (result.judgeStatus === "error") {
    return `<div class="faith"><h4>Faithfulness <span class="miss">error</span> <span class="muted">(${esc(result.judgeModel ?? "?")})</span></h4><p class="muted">${esc(result.judgeError ?? "judge failed")}</p></div>`;
  }
  if (result.synthesisStatus === "error") {
    return `<div class="faith"><h4>Faithfulness <span class="miss">n/a</span></h4><p class="muted">synthesis error: ${esc(result.synthesisError ?? "")}</p></div>`;
  }
  return ""; // deterministic mode or cleanly skipped (no key / no answer) — status shown in the summary line
}

function card(result: RunResult): string {
  const pass = itemGatePass(result);
  return `<details class="card" ${pass ? "" : "open"}>
    <summary><span class="qt">${esc(result.item.queryType)}</span> ${esc(result.item.question)} ${badge(pass)}
      <span class="metric">R ${result.recall.toFixed(2)} · P ${result.precision.toFixed(2)} · ${result.citationsResolve ? "refs ✓" : "refs ✗"}</span></summary>
    ${refDiff(result)}
    ${coverageBlock(result)}
    <h4>Retrieval trace</h4>
    ${traceRows(result)}
    ${faithfulnessBlock(result)}
  </details>`;
}

// Summarize a status field across questions as "ran A · error B · skipped C"
// (Finding 3): derived from the EXPLICIT statuses, never from output presence.
function statusTally(results: RunResult[], pick: (r: RunResult) => string): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(pick(r), (counts.get(pick(r)) ?? 0) + 1);
  return [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(" · ");
}

// Global hard-gate rows + a per-query-type recall/precision table (gated metrics
// badged PASS/FAIL; ungated metrics shown as "report-only").
function summaryTables(results: RunResult[]): string {
  const resolveOk = results.every((r) => r.citationsResolve);
  const requiredLemma = results.filter((r) => r.lemmaRequired);
  const lemmaOk = requiredLemma.every((r) => r.lemmaFound);

  const cell = (value: number, gated: boolean, pass: boolean) =>
    gated ? `${value.toFixed(2)} ${badge(pass)}` : `${value.toFixed(2)} <span class="muted">report-only</span>`;

  const types = [...new Set(results.map((r) => r.item.queryType))].sort() as QueryType[];
  const typeRows = types
    .map((t) => {
      const rows = results.filter((r) => r.item.queryType === t);
      const gate = TYPE_GATES[t];
      const rThresh = gate.recall;
      const pThresh = gate.precision;
      const mr = mean(rows.map((r) => r.recall));
      const mp = mean(rows.map((r) => r.precision));
      const recallPass = rThresh === undefined || rows.every((r) => r.recall >= rThresh);
      const precPass = pThresh === undefined || rows.every((r) => r.precision >= pThresh);
      return `<tr><td>${esc(t)}</td><td>${rows.length}</td><td>${cell(mr, gate.recall !== undefined, recallPass)}</td><td>${cell(mp, gate.precision !== undefined, precPass)}</td></tr>`;
    })
    .join("");

  return `
  <h2>Hard gates (all items)</h2>
  <table>
    <thead><tr><th>Gate</th><th>Result</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Citation resolvability</td><td>${results.filter((r) => r.citationsResolve).length}/${results.length} resolve</td><td>${badge(resolveOk)}</td></tr>
      <tr><td>Required lemma coverage</td><td>${requiredLemma.filter((r) => r.lemmaFound).length}/${requiredLemma.length} required lemmas surfaced</td><td>${badge(lemmaOk)}</td></tr>
    </tbody>
  </table>
  <h2>Per query type</h2>
  <table>
    <thead><tr><th>Query type</th><th>n</th><th>Mean recall</th><th>Mean precision</th></tr></thead>
    <tbody>${typeRows}</tbody>
  </table>`;
}

export function renderHtmlReport(results: RunResult[]): string {
  const f = meanFaithfulness(results);
  const synthTally = statusTally(results, (r) => r.synthesisStatus);
  const judgeTally = statusTally(results, (r) => r.judgeStatus);
  const synthModels = [...new Set(results.map((r) => r.synthesisModel).filter((m): m is string => Boolean(m)))];
  const judgeModels = [...new Set(results.map((r) => r.judgeModel).filter((m): m is string => Boolean(m)))];
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TextLab Eval Report</title>
<style>
  :root { --bg:#f6f5f1; --ink:#1f2933; --surface:#fff; --muted:#6b7280; --border:#d7d3ca; --accent:#365f7e; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Inter Tight", system-ui, sans-serif; line-height:1.5; padding:2rem; }
  h1,h2,h3 { font-family:"Spectral", Georgia, serif; }
  .accent-rule { border-left:3px solid var(--accent); padding-left:.75rem; }
  table { border-collapse:collapse; width:100%; background:var(--surface); margin-bottom:1rem; }
  th,td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--border); }
  .badge { font-size:.7rem; font-weight:600; padding:.1rem .45rem; border-radius:3px; }
  .badge.pass { background:#e3efe5; color:#1d6b3a; } .badge.fail { background:#f5e0e0; color:#9b2c2c; }
  .card { background:var(--surface); border:1px solid var(--border); border-left:3px solid var(--accent); margin:.75rem 0; padding:.5rem .9rem; border-radius:4px; }
  .card summary { cursor:pointer; }
  .qt { display:inline-block; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); margin-right:.5rem; }
  .metric { color:var(--muted); font-size:.8rem; margin-left:.5rem; }
  .refcols { display:flex; gap:2rem; margin:.6rem 0; }
  .refcols ul { list-style:none; padding:0; margin:0; font-variant-numeric:tabular-nums; }
  .hit { color:#1d6b3a; } .miss { color:#9b2c2c; } .extra { color:var(--muted); }
  .trace { font-size:.85rem; } .muted { color:var(--muted); }
  .faith { margin-top:.6rem; }
</style></head>
<body>
  <h1 class="accent-rule">TextLab Evaluation Report</h1>
  <p class="muted">Generated ${esc(new Date().toISOString())} · ${results.length} questions ·
    synthesis: ${esc(synthTally)} ·
    judge: ${esc(judgeTally)} ·
    synthesis models: ${esc(synthModels.length ? synthModels.join(", ") : "n/a")} ·
    judge models: ${esc(judgeModels.length ? judgeModels.join(", ") : "n/a")} ·
    mean faithfulness: ${f === null ? "n/a" : f.toFixed(2)}</p>
  ${summaryTables(results)}
  <h2>Questions</h2>
  ${results.map(card).join("\n")}
</body></html>`;
}
