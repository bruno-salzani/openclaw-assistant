import "dotenv/config";
import path from "node:path";

import { runEval } from "./runner.js";

function arg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const datasetArg = arg("--dataset") ?? arg("-d");
  const limitArg = arg("--limit") ?? arg("-n");
  const datasetPath = datasetArg
    ? path.resolve(process.cwd(), datasetArg)
    : path.resolve(process.cwd(), "eval", "datasets", "sample.jsonl");
  const limit = limitArg ? Number(limitArg) : undefined;

  const { report, reportPath } = await runEval({ datasetPath, limit });
  const accuracy = report.total ? `${report.accuracyPct.toFixed(1)}%` : "0%";
  const avgLatency = `${report.avgLatencyMs.toFixed(1)}ms`;
  const toolRate = `${report.toolSuccessRatePct.toFixed(1)}%`;

  console.log(`prompts ${report.total}`);
  console.log(`accuracy ${accuracy}`);
  console.log(`avg latency ${avgLatency}`);
  console.log(`p50 latency ${report.p50LatencyMs.toFixed(0)}ms`);
  console.log(`p95 latency ${report.p95LatencyMs.toFixed(0)}ms`);
  console.log(`tool success ${toolRate}`);
  console.log(`report ${reportPath}`);

  const failed = report.results.filter((r) => !r.ok).slice(0, 10);
  if (failed.length > 0) {
    console.log("failed cases:");
    for (const f of failed) {
      console.log(`- ${f.id}: ${f.reason ?? "failed"}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
