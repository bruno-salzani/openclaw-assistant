import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { Scenario, ScenarioTask } from "./scenario-loader.js";
import { SimulationEnvironment, type SimulationConfig } from "./environment.js";

export type ScenarioRunResult = {
  scenario: string;
  ok: boolean;
  results: Array<{
    idx: number;
    task: ScenarioTask;
    ok: boolean;
    latencyMs: number;
    outputChars: number;
    error?: string;
  }>;
  summary: {
    total: number;
    okCount: number;
    avgLatencyMs: number;
  };
};

export async function runScenario(params: {
  orchestrator: AgentOrchestrator;
  scenario: Scenario;
  env?: SimulationEnvironment;
  envConfig?: SimulationConfig;
}) {
  const env = params.env ?? new SimulationEnvironment(params.envConfig);
  const out: ScenarioRunResult["results"] = [];
  for (let i = 0; i < params.scenario.tasks.length; i++) {
    const task = params.scenario.tasks[i]!;
    const start = Date.now();
    try {
      if (env.shouldFail()) throw new Error("simulated_failure");
      const res = await params.orchestrator.run({
        sessionId: `sim-${params.scenario.name}-${Date.now()}`,
        userId: "simulation",
        userRole: task.userRole ?? "user",
        text: task.text,
        channel: task.channel ?? "console",
      } as any);
      out.push({
        idx: i,
        task,
        ok: true,
        latencyMs: Date.now() - start,
        outputChars: String(res.text ?? "").length,
      });
    } catch (e: any) {
      out.push({
        idx: i,
        task,
        ok: false,
        latencyMs: Date.now() - start,
        outputChars: 0,
        error: String(e?.message ?? e ?? "error"),
      });
    }
  }
  const okCount = out.filter((r) => r.ok).length;
  const avgLatencyMs = out.length ? out.reduce((a, r) => a + r.latencyMs, 0) / out.length : 0;
  return {
    scenario: params.scenario.name,
    ok: okCount === out.length,
    results: out,
    summary: { total: out.length, okCount, avgLatencyMs },
  } satisfies ScenarioRunResult;
}

