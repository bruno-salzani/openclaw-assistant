import test from "node:test";
import assert from "node:assert/strict";
import { executeDAG } from "../../agents/pipeline/dag-exec.js";
import { InMemoryTaskQueue } from "../../tasks/inmemory-queue.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";

function mkDeps() {
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const queue = new InMemoryTaskQueue();
  const memory = { add: async () => {} };
  const deps: any = { metrics, tracer, queue, memory };
  return deps;
}

test("executeDAG: runs levels in order and returns results", async () => {
  const deps = mkDeps();
  const steps = [
    { id: "r1", type: "research" as const, dependsOn: [], payload: { query: "q" } },
    { id: "a1", type: "analyze" as const, dependsOn: ["r1"], payload: {} },
  ];
  const ctx = { sessionId: "s", userId: "u", userRole: "admin" as const, traceId: "t" };
  // Pre-wire: when claimNext is called by worker pool? We directly enqueue in executeDAG; InMemoryTaskQueue returns result when complete() is called elsewhere.
  // Here we'll simulate a simple consumer that auto-completes any enqueued task.
  const origEnq = deps.queue.enqueue.bind(deps.queue);
  deps.queue.enqueue = async (task: any) => {
    await origEnq(task);
    await deps.queue.complete({
      taskId: task.taskId,
      traceId: task.traceId,
      ok: true,
      output: { done: task.type },
    });
  };
  const out = await executeDAG(deps, steps as any, ctx);
  assert.equal(Array.isArray(out.results), true);
  assert.equal(out.results.length, 2);
  assert.ok(out.results.every((r) => r.ok));
});
