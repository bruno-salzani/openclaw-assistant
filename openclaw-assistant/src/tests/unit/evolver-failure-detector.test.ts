import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { MetricsRegistry } from "../../observability/metrics.js";
import { FailureDetector, buildEvolverTasksFromSignals } from "../../evolver/failure-detector.js";

test("FailureDetector triggers evolver tasks when fail rates exceed thresholds", async () => {
  process.env.IA_ASSISTANT_EVOLVER_TOOL_FAIL_RATE_THRESHOLD = "0.2";
  process.env.IA_ASSISTANT_EVOLVER_TASK_FAIL_RATE_THRESHOLD = "0.1";
  process.env.IA_ASSISTANT_EVOLVER_AGENT_AVG_LATENCY_MS_THRESHOLD = "1000";

  const metrics = new MetricsRegistry();
  const fd = new FailureDetector(metrics);
  await fd.sample();

  metrics.counter("tool_executions_total").inc(100);
  metrics.counter("tool_errors_total").inc(30);
  metrics.counter("task_started_total").inc(50);
  metrics.counter("task_failed_total").inc(10);
  metrics.histogram("agent_latency_seconds").observe(2.0);
  metrics.histogram("agent_latency_seconds").observe(2.0);
  metrics.histogram("agent_latency_seconds").observe(2.0);

  const signals = await fd.sample();
  const repoRoot = path.resolve(process.cwd());
  const tasks = buildEvolverTasksFromSignals({ repoRoot, signals });

  assert.ok(tasks.length >= 2);
  assert.ok(
    tasks.some((t) =>
      String(t.filePath ?? "").includes(path.join("src", "tools", "execution-engine.ts"))
    )
  );
  assert.ok(
    tasks.some((t) =>
      String(t.filePath ?? "").includes(path.join("src", "tasks", "worker-pool.ts"))
    )
  );
});
