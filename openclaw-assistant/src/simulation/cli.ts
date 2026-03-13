import "dotenv/config";
import path from "node:path";
import { loadScenarioFromFile } from "./scenario-loader.js";
import { runScenario } from "./scenario-runner.js";
import { createRuntime } from "../runtime.js";
import { SimulationEnvironment } from "./environment.js";
import { computeRunMetrics } from "./metrics-engine.js";
import { evaluateAgent } from "./agent-evaluator.js";

function argValue(args: string[], key: string) {
  const idx = args.findIndex((a) => a === key);
  if (idx < 0) return null;
  const v = args[idx + 1];
  return typeof v === "string" ? v : null;
}

function hasFlag(args: string[], key: string) {
  return args.includes(key);
}

function usage() {
  const txt = [
    "Usage:",
    "  tsx src/simulation/cli.ts run --scenario <path> [--runs 1] [--failureRate 0] [--seed 123] [--worldId demo --persistWorld 1]",
    "",
    "Examples:",
    "  tsx src/simulation/cli.ts run --scenario src/simulation/scenarios/research-task.yaml",
  ].join("\n");
  process.stdout.write(`${txt}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "";
  if (!cmd || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    usage();
    process.exitCode = 0;
    return;
  }

  if (cmd !== "run") {
    process.stderr.write(`unknown command: ${cmd}\n`);
    usage();
    process.exitCode = 2;
    return;
  }

  const scenarioPath = argValue(args, "--scenario") ?? "";
  if (!scenarioPath.trim()) {
    process.stderr.write("missing --scenario\n");
    usage();
    process.exitCode = 2;
    return;
  }

  const runs = Math.max(1, Math.min(50, Number(argValue(args, "--runs") ?? 1)));
  const failureRate = Number(argValue(args, "--failureRate") ?? 0);
  const seed = Number(argValue(args, "--seed") ?? Date.now());
  const worldId = argValue(args, "--worldId") ?? undefined;
  const persistWorld = String(argValue(args, "--persistWorld") ?? "0") === "1";

  const scenario = loadScenarioFromFile(path.resolve(scenarioPath));

  const runtime = await createRuntime();
  try {
    const env = new SimulationEnvironment({ failureRate, seed, worldId: worldId ?? undefined, persistWorld });
    const all: Array<{ ok: boolean; latencyMs: number; outputChars: number }> = [];
    const runsOut: any[] = [];
    for (let i = 0; i < runs; i++) {
      const res = await runScenario({ orchestrator: runtime.orchestrator, scenario, env });
      runsOut.push(res);
      for (const r of res.results) all.push({ ok: r.ok, latencyMs: r.latencyMs, outputChars: r.outputChars });
    }
    const metrics = computeRunMetrics(all);
    const score = evaluateAgent({ metrics });
    process.stdout.write(`${JSON.stringify({ scenario: scenario.name, runs, metrics, score, runsOut }, null, 2)}\n`);
  } finally {
    runtime.stop();
  }
}

main().catch((e) => {
  process.stderr.write(`${String(e?.stack ?? e)}\n`);
  process.exitCode = 1;
});
