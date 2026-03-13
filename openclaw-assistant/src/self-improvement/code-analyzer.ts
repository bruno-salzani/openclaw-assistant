import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentObsEvent } from "../observability/agent-tracker.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { FailureDetector, buildEvolverTasksFromSignals } from "../evolver/failure-detector.js";
import type { EvolverTask } from "../evolver/types.js";

function abs(repoRoot: string, rel: string) {
  return path.resolve(repoRoot, rel);
}

function exists(p: string) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function guessAgentFilePath(repoRoot: string, agent: string) {
  const a = String(agent ?? "").trim();
  if (!a) return null;
  const candidates = [
    abs(repoRoot, path.join("src", "agents", "roles", `${a}-agent.ts`)),
    abs(repoRoot, path.join("src", "agents", "roles", `${a.replaceAll("_", "-")}-agent.ts`)),
    abs(repoRoot, path.join("src", "agents", "orchestrator.ts")),
    abs(repoRoot, path.join("src", "agents", "registry.ts")),
  ];
  for (const p of candidates) {
    if (exists(p)) return p;
  }
  return null;
}

function normalizeThreshold(raw: unknown, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export class CodeAnalyzer {
  private readonly detector: FailureDetector;

  constructor(
    private readonly deps: {
      repoRoot: string;
      metrics: MetricsRegistry;
    }
  ) {
    this.detector = new FailureDetector(deps.metrics);
  }

  async analyzeMetrics(): Promise<{ tasks: EvolverTask[]; signals: unknown }> {
    const signals = await this.detector.sample();
    const tasks = buildEvolverTasksFromSignals({ repoRoot: this.deps.repoRoot, signals });
    return { tasks, signals };
  }

  analyzeAiObservability(evt: AgentObsEvent): EvolverTask[] {
    const now = Date.now();
    const latencyThresholdMs = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_LATENCY_MS_THRESHOLD,
      2500
    );
    const tokensThreshold = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOKENS_THRESHOLD,
      8000
    );
    const toolCallsThreshold = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOOL_CALLS_THRESHOLD,
      15
    );

    const tasks: EvolverTask[] = [];
    const filePath = guessAgentFilePath(this.deps.repoRoot, evt.agent);
    if (!filePath) return tasks;

    const evidenceBase = [
      `agent=${evt.agent}`,
      `sessionId=${evt.sessionId}`,
      evt.traceId ? `traceId=${evt.traceId}` : "",
    ].filter(Boolean);

    if (!evt.ok) {
      tasks.push({
        id: randomUUID(),
        type: "reduce_risk_candidate",
        title: `Melhorar robustez do agente ${evt.agent} (execução falhou)`,
        filePath,
        evidence: [
          ...evidenceBase,
          `ok=false`,
          `latencyMs=${Math.round(evt.latencyMs)}`,
          `toolCalls=${evt.toolCalls}`,
          `tokensTotal=${evt.tokens.total}`,
        ],
        priority: "high",
        createdAt: now,
      });
    }

    if (evt.latencyMs >= latencyThresholdMs) {
      const severity = evt.latencyMs >= latencyThresholdMs * 2 ? "high" : "medium";
      tasks.push({
        id: randomUUID(),
        type: "performance_candidate",
        title: `Reduzir latência do agente ${evt.agent}`,
        filePath,
        evidence: [
          ...evidenceBase,
          `latencyMs=${Math.round(evt.latencyMs)} thresholdMs=${Math.round(latencyThresholdMs)}`,
          `toolCalls=${evt.toolCalls}`,
          `tokensTotal=${evt.tokens.total}`,
        ],
        priority: severity,
        createdAt: now,
      });
    }

    if (evt.tokens.total >= tokensThreshold) {
      tasks.push({
        id: randomUUID(),
        type: "refactor_candidate",
        title: `Reduzir tokens do agente ${evt.agent} (prompt/estrutura)`,
        filePath,
        evidence: [
          ...evidenceBase,
          `tokensTotal=${evt.tokens.total} threshold=${Math.round(tokensThreshold)}`,
          `latencyMs=${Math.round(evt.latencyMs)}`,
          `toolCalls=${evt.toolCalls}`,
        ],
        priority: evt.tokens.total >= tokensThreshold * 2 ? "high" : "medium",
        createdAt: now,
      });
    }

    if (evt.toolCalls >= toolCallsThreshold) {
      tasks.push({
        id: randomUUID(),
        type: "reduce_risk_candidate",
        title: `Reduzir loops/cascatas de tool calls no agente ${evt.agent}`,
        filePath: abs(this.deps.repoRoot, path.join("src", "tools", "execution-engine.ts")),
        evidence: [
          ...evidenceBase,
          `toolCalls=${evt.toolCalls} threshold=${Math.round(toolCallsThreshold)}`,
          `tokensTotal=${evt.tokens.total}`,
          `latencyMs=${Math.round(evt.latencyMs)}`,
        ],
        priority: evt.toolCalls >= toolCallsThreshold * 2 ? "high" : "medium",
        createdAt: now,
      });
    }

    return tasks.filter((t) => Boolean(t.filePath && exists(t.filePath)));
  }
}

