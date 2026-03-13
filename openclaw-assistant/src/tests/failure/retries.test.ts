import test from "node:test";
import assert from "node:assert/strict";
import { TaskWorkerPool } from "../../tasks/worker-pool.js";
import { InMemoryTaskQueue } from "../../tasks/inmemory-queue.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";

test("WorkerPool marks failure and schedules retry", async () => {
  const queue = new InMemoryTaskQueue();
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const memory: any = {
    incrementTaskRetry: async () => {},
    updateTask: async () => {},
  };
  // Minimal agent list with one analyst that always throws
  const agents: any[] = [
    {
      role: "analyst",
      handle: async () => {
        throw new Error("boom");
      },
    },
  ];
  const pool = new TaskWorkerPool({ queue, agents, tracer, metrics, memory });
  // Create a task that will be routed to analyst
  const t = {
    taskId: "t1",
    traceId: "trace",
    sessionId: "s",
    userId: "u",
    userRole: "admin" as const,
    type: "analyze" as const,
    priority: "medium" as const,
    status: "pending" as const,
    payload: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await queue.enqueue(t as any);
  // Start a single worker for analyze
  pool.start(1, ["analyze"]);
  const result = await queue.waitForResult("t1", 5000);
  assert.equal(result.ok, false);
  pool.stop();
  await new Promise((r) => setTimeout(r, 50));
  const snap = await queue.snapshot(50);
  const retryTask = snap.tasks.find(
    (x: any) => x.taskId !== "t1" && (x.payload as any)?.retries === 1
  );
  assert.ok(retryTask);
});
