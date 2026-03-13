import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryTaskQueue } from "../../tasks/inmemory-queue.js";
import { DistributedTaskDispatcher } from "../../distributed/task-dispatcher.js";
import { LoadBalancer } from "../../distributed/load-balancer.js";

test("LoadBalancer prefers least utilized node", async () => {
  const lb = new LoadBalancer({ strategy: "least_busy" });
  const picked = lb.pickNode({
    nodes: [
      { nodeId: "a", role: "worker", types: ["research"], capacity: 10, busy: 8, lastSeenAt: Date.now() } as any,
      { nodeId: "b", role: "worker", types: ["research"], capacity: 10, busy: 2, lastSeenAt: Date.now() } as any,
    ],
    role: "worker",
    type: "research" as any,
  });
  assert.equal(picked?.nodeId, "b");
});

test("DistributedTaskDispatcher assigns nodeId on enqueue and enforces assignment on claimNext", async () => {
  const base = new InMemoryTaskQueue();
  const registry: any = {
    list: async () => [
      { nodeId: "node-b", role: "worker", types: ["research"], capacity: 10, busy: 1, lastSeenAt: Date.now() },
    ],
  };
  const dispatcher = new DistributedTaskDispatcher({
    base,
    registry,
    strategy: "least_busy",
    staleMs: 15_000,
    workerNodeId: "node-a",
    enforceAssignment: true,
  });

  await dispatcher.enqueue({
    taskId: "t1",
    traceId: "tr1",
    sessionId: "s1",
    userId: "u1",
    userRole: "user",
    type: "research",
    priority: "medium",
    status: "pending",
    payload: { q: "x" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);

  const snap = await dispatcher.snapshot(10);
  assert.equal(snap.tasks.length, 1);
  assert.equal((snap.tasks[0] as any).assignedNodeId, "node-b");

  const claimed = await dispatcher.claimNext(["research"] as any, "w1");
  assert.equal(claimed, undefined);

  const stats = await dispatcher.stats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.running, 0);
});
