import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { AgentContext } from "../agents/types.js";

export type AgentBenchmarkCase = {
  name: string;
  input: Pick<AgentContext, "sessionId" | "userId" | "userRole" | "text" | "channel">;
};

export type AgentBenchmarkResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  outputChars: number;
};

export async function runAgentBenchmarks(params: {
  orchestrator: AgentOrchestrator;
  cases: AgentBenchmarkCase[];
}) {
  const results: AgentBenchmarkResult[] = [];
  for (const c of params.cases) {
    const start = Date.now();
    try {
      const res = await params.orchestrator.run(c.input as any);
      results.push({
        name: c.name,
        ok: true,
        latencyMs: Date.now() - start,
        outputChars: String(res.text ?? "").length,
      });
    } catch {
      results.push({
        name: c.name,
        ok: false,
        latencyMs: Date.now() - start,
        outputChars: 0,
      });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const avgLatency = results.length
    ? results.reduce((a, r) => a + r.latencyMs, 0) / results.length
    : 0;
  return { ok: okCount === results.length, results, summary: { okCount, total: results.length, avgLatency } };
}

