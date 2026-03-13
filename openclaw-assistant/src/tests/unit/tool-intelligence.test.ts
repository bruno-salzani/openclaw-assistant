import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "../../infra/event-bus.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { ToolProfiler } from "../../tools/intelligence/tool-profiler.js";
import { recommendTools } from "../../tools/intelligence/tool-recommendation.js";

test("ToolExecutionEngine emits tool.executed on error and profiler records it", async () => {
  const bus = new EventBus();
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  tools.setBus(bus);

  const saved: any[] = [];
  const memory: any = { add: async (_t: any, _k: any, v: any) => saved.push(v) };
  const profiler = new ToolProfiler({ bus, memory }, { latencyWindow: 50, flushEveryMs: 5_000 });
  profiler.start();

  tools.registerTool("demo.fail", async () => {
    throw new Error("boom");
  });

  await assert.rejects(
    () =>
      tools.execute(
        "demo.fail",
        { a: 1 },
        { userRole: "admin", permissions: ["demo.*"], workspaceId: "ws:x", traceId: "t1" }
      ),
    /boom/
  );

  const p = profiler.getProfile("demo.fail");
  assert.ok(p);
  assert.equal(p!.calls, 1);
  assert.equal(p!.errors, 1);
  assert.equal(p!.success, 0);
});

test("recommendTools prefers higher success rate and lower latency", async () => {
  const profiles: any[] = [
    {
      tool: "search-tool-a",
      calls: 100,
      success: 82,
      errors: 18,
      successRate: 0.82,
      errorRate: 0.18,
      avgLatencyMs: 900,
      p95LatencyMs: 1600,
      avgCostUsd: 0,
      lastSeenAt: Date.now(),
    },
    {
      tool: "search-tool-b",
      calls: 60,
      success: 55,
      errors: 5,
      successRate: 0.91,
      errorRate: 0.09,
      avgLatencyMs: 700,
      p95LatencyMs: 1200,
      avgCostUsd: 0,
      lastSeenAt: Date.now(),
    },
  ];
  const out = recommendTools({ profiles, query: "search", limit: 2 });
  assert.equal(out.best, "search-tool-b");
  assert.equal(out.ranked.length, 2);
});
