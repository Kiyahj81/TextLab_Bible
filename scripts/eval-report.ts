// scripts/eval-report.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import goldenSet from "@/eval/dataset/golden-set.json";
import { goldenSetSchema } from "@/eval/dataset/schema";
import { runWithJudge, type RunResult } from "@/eval/runner";
import { renderHtmlReport, renderJsonReport } from "@/eval/report";

async function main() {
  const items = goldenSetSchema.parse(goldenSet);
  const synth = Boolean(process.env.OPENAI_API_KEY);
  const judge = Boolean(process.env.AI_GATEWAY_API_KEY);
  console.log(`Running ${items.length} questions (live synthesis: ${synth ? "on" : "off"}, faithfulness judge: ${judge ? "on" : "off"})`);

  const results: RunResult[] = [];
  for (const item of items) {
    console.log(`  • ${item.id}`);
    results.push(await runWithJudge(item));
  }

  const outDir = path.join(process.cwd(), "eval", "output");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "report.html"), renderHtmlReport(results), "utf8");
  await writeFile(path.join(outDir, "report.json"), renderJsonReport(results), "utf8");
  console.log(`\nWrote eval/output/report.html and report.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
