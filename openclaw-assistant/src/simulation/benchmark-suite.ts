import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { Scenario } from "./scenario-loader.js";
import { runScenario } from "./scenario-runner.js";
import { computeRunMetrics } from "./metrics-engine.js";
import { evaluateAgent } from "./agent-evaluator.js";
import { SimulationEnvironment, type SimulationConfig } from "./environment.js";

export async function runBenchmarkSuite(params: {
  orchestrator: AgentOrchestrator;
  scenarios: Scenario[];
  runsPerScenario?: number;
  envConfig?: SimulationConfig;
}) {
  const runsPerScenario = Math.max(1, Math.min(50, Number(params.runsPerScenario ?? 1)));
  const env = new SimulationEnvironment(params.envConfig);
  const allResults: Array<{ scenario: string; ok: boolean; latencyMs: number; outputChars: number }> = [];
  const runs: any[] = [];

  for (const scenario of params.scenarios) {
    for (let i = 0; i < runsPerScenario; i++) {
      const res = await runScenario({ orchestrator: params.orchestrator, scenario, env });
      runs.push(res);
      for (const r of res.results) {
        allResults.push({
          scenario: scenario.name,
          ok: r.ok,
          latencyMs: r.latencyMs,
          outputChars: r.outputChars,
        });
      }
    }
  }

  const metrics = computeRunMetrics(allResults);
  const score = evaluateAgent({ metrics });

  return { runs, metrics, score };
}

