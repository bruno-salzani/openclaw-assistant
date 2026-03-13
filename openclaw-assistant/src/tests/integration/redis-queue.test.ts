import test from "node:test";
import assert from "node:assert/strict";
import { RedisTaskQueue } from "../../tasks/redis-queue.js";
import type { Task } from "../../tasks/task-types.js";

const url = process.env.REDIS_URL || process.env.OPENCLAW_X_TASKS_REDIS_URL;

test("RedisTaskQueue: claimNext finds compatible type by scanning", { skip: !url }, async () => {
  const queue = new RedisTaskQueue(url as string, "ia-assistant:test1");
  const now = Date.now();
  const t1: Task = {
    taskId: "rt1",
    traceId: "tr1",
    sessionId: "s",
    userId: "u",
    userRole: "admin",
    type: "execute",
    priority: "medium",
    status: "pending",
    payload: {},
    createdAt: now,
    updatedAt: now,
  };
  const t2: Task = { ...t1, taskId: "rt2", type: "research" };
  await queue.enqueue(t1);
  await queue.enqueue(t2);
  const a = await queue.claimNext(["research"], "w1");
  assert.ok(a && a.taskId === "rt2");
});
