import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { EvolverTask } from "./types.js";

type CounterSnapshot = {
  atMs: number;
  values: Map<string, number>;
};

function parsePrometheus(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const parts = l.split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    if (!name || name.includes("{")) continue;
    const v = Number(parts[1]);
    if (!Number.isFinite(v)) continue;
    out.set(name, v);
  }
  return out;
}

function delta(curr: CounterSnapshot, prev: CounterSnapshot | null, name: string) {
  const cur = curr.values.get(name);
  if (cur == null) return null;
  const old = prev?.values.get(name);
  const d = old == null ? cur : cur - old;
  if (!Number.isFinite(d) || d < 0) return null;
  return d;
}

export type EvolverSignals = {
  toolFailRate?: { rate: number; executions: number; errors: number };
  taskFailRate?: { rate: number; started: number; failed: number };
  agentLatencyAvgMs?: { avgMs: number; count: number };
};

export class FailureDetector {
  private prev: CounterSnapshot | null = null;

  constructor(private readonly metrics: MetricsRegistry) {}

  async sample(): Promise<EvolverSignals> {
    const now = Date.now();
    const raw = await this.metrics.prometheus();
    const curr: CounterSnapshot = { atMs: now, values: parsePrometheus(raw) };
    const prev = this.prev;
    this.prev = curr;
    if (!prev) return {};

    const exec = delta(curr, prev, "tool_executions_total") ?? 0;
    const err = delta(curr, prev, "tool_errors_total") ?? 0;
    const toolFailRate = exec > 0 ? err / exec : 0;

    const started = delta(curr, prev, "task_started_total") ?? 0;
    const failed = delta(curr, prev, "task_failed_total") ?? 0;
    const taskFailRate = started > 0 ? failed / started : 0;

    const latencySum = delta(curr, prev, "agent_latency_seconds_sum");
    const latencyCount = delta(curr, prev, "agent_latency_seconds_count");
    const agentLatencyAvgMs =
      latencySum != null && latencyCount != null && latencyCount > 0
        ? (latencySum / latencyCount) * 1000
        : null;

    return {
      toolFailRate: { rate: toolFailRate, executions: exec, errors: err },
      taskFailRate: { rate: taskFailRate, started, failed },
      agentLatencyAvgMs: agentLatencyAvgMs != null ? { avgMs: agentLatencyAvgMs, count: latencyCount ?? 0 } : undefined,
    };
  }
}

function abs(repoRoot: string, rel: string) {
  return path.resolve(repoRoot, rel);
}

export function buildEvolverTasksFromSignals(params: {
  repoRoot: string;
  signals: EvolverSignals;
}): EvolverTask[] {
  const now = Date.now();
  const tasks: EvolverTask[] = [];

  const toolThreshold = Number(process.env.IA_ASSISTANT_EVOLVER_TOOL_FAIL_RATE_THRESHOLD ?? 0.25);
  const taskThreshold = Number(process.env.IA_ASSISTANT_EVOLVER_TASK_FAIL_RATE_THRESHOLD ?? 0.1);
  const latencyThresholdMs = Number(process.env.IA_ASSISTANT_EVOLVER_AGENT_AVG_LATENCY_MS_THRESHOLD ?? 1800);

  const tool = params.signals.toolFailRate;
  if (tool && tool.executions >= 10 && tool.rate >= toolThreshold) {
    tasks.push({
      id: randomUUID(),
      type: "reduce_risk_candidate",
      title: "Melhorar robustez do ToolExecutionEngine (alto fail rate)",
      filePath: abs(params.repoRoot, "src/tools/execution-engine.ts"),
      evidence: [
        `tool_fail_rate=${tool.rate.toFixed(3)} threshold=${toolThreshold}`,
        `tool_executions_window=${tool.executions} tool_errors_window=${tool.errors}`,
      ],
      priority: tool.rate >= toolThreshold * 1.5 ? "high" : "medium",
      createdAt: now,
    });
  }

  const task = params.signals.taskFailRate;
  if (task && task.started >= 10 && task.rate >= taskThreshold) {
    tasks.push({
      id: randomUUID(),
      type: "reduce_risk_candidate",
      title: "Melhorar confiabilidade do TaskWorkerPool (alto task fail rate)",
      filePath: abs(params.repoRoot, "src/tasks/worker-pool.ts"),
      evidence: [
        `task_fail_rate=${task.rate.toFixed(3)} threshold=${taskThreshold}`,
        `task_started_window=${task.started} task_failed_window=${task.failed}`,
      ],
      priority: task.rate >= taskThreshold * 1.5 ? "high" : "medium",
      createdAt: now,
    });
  }

  const latency = params.signals.agentLatencyAvgMs;
  if (latency && latency.count >= 5 && latency.avgMs >= latencyThresholdMs) {
    tasks.push({
      id: randomUUID(),
      type: "performance_candidate",
      title: "Reduzir latência média de agentes (avg alta)",
      filePath: abs(params.repoRoot, "src/agents/roles/research-agent.ts"),
      evidence: [
        `agent_latency_avg_ms=${latency.avgMs.toFixed(1)} threshold_ms=${latencyThresholdMs}`,
        `agent_latency_samples_window=${latency.count}`,
      ],
      priority: latency.avgMs >= latencyThresholdMs * 1.5 ? "high" : "medium",
      createdAt: now,
    });
  }

  return tasks.slice(0, Number(process.env.IA_ASSISTANT_EVOLVER_MAX_RUNTIME_TASKS ?? 3));
}
