import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { MetricsRegistry } from "../../observability/metrics.js";
import { CodeAnalyzer } from "../../self-improvement/code-analyzer.js";

test("CodeAnalyzer: gera tarefas a partir de ai.observability (latência/tokens/tool calls)", () => {
  process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_LATENCY_MS_THRESHOLD = "10";
  process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOKENS_THRESHOLD = "5";
  process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOOL_CALLS_THRESHOLD = "1";

  const repoRoot = process.cwd();
  const metrics = new MetricsRegistry();
  const analyzer = new CodeAnalyzer({ repoRoot, metrics });

  const tasks = analyzer.analyzeAiObservability({
    agent: "planner",
    sessionId: "s",
    traceId: "t",
    latencyMs: 25,
    toolCalls: 2,
    tokens: { prompt: 3, completion: 3, total: 6 },
    costUsd: 0,
    ok: true,
    ts: Date.now(),
  });

  assert.ok(tasks.length >= 2);
  assert.ok(tasks.some((t) => String(t.filePath ?? "").includes(path.join("src", "agents", "roles"))));
  assert.ok(
    tasks.some((t) => String(t.filePath ?? "").includes(path.join("src", "tools", "execution-engine.ts")))
  );
});

