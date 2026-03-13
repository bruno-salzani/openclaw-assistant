import { Redis } from "ioredis";
import type { Task, TaskResult, TaskType } from "./task-types.js";
import type { TaskQueue, TaskQueueStats } from "./task-queue.js";

type QueueKeys = {
  pending: string;
  processing: string; // list of claimed taskIds pending ack
  processingTs: string; // zset(taskId -> claimedAtMs)
  running: string; // set of running taskIds
  results: string;
  pubsub: string;
  tasks: string; // hash of all tasks by id
};

function keys(namespace: string): QueueKeys {
  return {
    pending: `${namespace}:pending`,
    processing: `${namespace}:processing`,
    processingTs: `${namespace}:processing_ts`,
    running: `${namespace}:running`,
    results: `${namespace}:results`,
    pubsub: `${namespace}:pubsub`,
    tasks: `${namespace}:tasks`,
  };
}

export class RedisTaskQueue implements TaskQueue {
  private readonly client: Redis;

  private readonly subscriber: Redis;

  private readonly k: QueueKeys;

  private subscribed = false;

  private subscribing?: Promise<void>;

  private readonly waiters = new Map<
    string,
    { resolve: (r: TaskResult) => void; reject: (e: Error) => void; timer: any }
  >();

  constructor(url: string, namespace = "ia-assistant:tasks") {
    this.client = new Redis(url);
    this.subscriber = new Redis(url);
    this.k = keys(namespace);
  }

  async enqueue(task: Task): Promise<void> {
    await this.client.hset(this.k.tasks, task.taskId, JSON.stringify(task));
    // Avoid duplicate pending entries by removing existing occurrences
    await this.client.lrem(this.k.pending, 0, task.taskId);
    await this.client.lrem(this.k.processing, 0, task.taskId);
    await this.client.zrem(this.k.processingTs, task.taskId);
    await this.client.srem(this.k.running, task.taskId);
    await this.client.lpush(this.k.pending, task.taskId);
  }

  async claimNext(types: TaskType[], workerId: string): Promise<Task | undefined> {
    let attempts = 0;
    const max = Math.max(1, Math.min(50, await this.client.llen(this.k.pending)));
    while (attempts < max) {
      const id = await this.client.rpoplpush(this.k.pending, this.k.processing);
      if (!id) return undefined;
      const raw = await this.client.hget(this.k.tasks, id);
      if (!raw) {
        await this.client.lrem(this.k.processing, 1, id);
        attempts++;
        continue;
      }
      const task = JSON.parse(raw) as Task;
      if (!types.includes(task.type)) {
        await this.client.lrem(this.k.processing, 1, id);
        await this.client.lpush(this.k.pending, id);
        attempts++;
        continue;
      }
      await this.client.zadd(this.k.processingTs, String(Date.now()), id);
      const updated: Task = { ...task, status: "running", updatedAt: Date.now() };
      await this.client.hset(this.k.tasks, id, JSON.stringify(updated));
      await this.client.sadd(this.k.running, id);
      await this.client.publish(
        this.k.pubsub,
        JSON.stringify({ event: "task_started", taskId: id, workerId })
      );
      return updated;
    }
    return undefined;
  }

  async complete(result: TaskResult): Promise<void> {
    await this.client.hset(this.k.results, result.taskId, JSON.stringify(result));
    await this.client.srem(this.k.running, result.taskId);
    await this.client.lrem(this.k.processing, 0, result.taskId);
    await this.client.zrem(this.k.processingTs, result.taskId);
    await this.client.publish(
      this.k.pubsub,
      JSON.stringify({ event: "task_completed", taskId: result.taskId })
    );
  }

  async fail(result: TaskResult): Promise<void> {
    await this.client.hset(this.k.results, result.taskId, JSON.stringify(result));
    await this.client.srem(this.k.running, result.taskId);
    await this.client.lrem(this.k.processing, 0, result.taskId);
    await this.client.zrem(this.k.processingTs, result.taskId);
    await this.client.publish(
      this.k.pubsub,
      JSON.stringify({ event: "task_failed", taskId: result.taskId })
    );
  }

  async reapStuckProcessing(timeoutMs = 300_000, limit = 50): Promise<{ requeued: number }> {
    const cutoff = Date.now() - timeoutMs;
    const ids = await this.client.zrangebyscore(this.k.processingTs, 0, cutoff, "LIMIT", 0, limit);
    let requeued = 0;
    for (const id of ids) {
      const removed = await this.client.zrem(this.k.processingTs, id);
      if (removed <= 0) continue;
      await this.client.lrem(this.k.processing, 0, id);
      await this.client.srem(this.k.running, id);
      const raw = await this.client.hget(this.k.tasks, id);
      if (raw) {
        try {
          const task = JSON.parse(raw) as Task;
          const updated: Task = { ...task, status: "pending", updatedAt: Date.now() };
          await this.client.hset(this.k.tasks, id, JSON.stringify(updated));
        } catch {}
      }
      await this.client.lpush(this.k.pending, id);
      requeued++;
    }
    return { requeued };
  }

  private async ensureSubscribed() {
    if (this.subscribed) return;
    if (this.subscribing) return this.subscribing;
    this.subscribing = (async () => {
      await this.subscriber.subscribe(this.k.pubsub);
      this.subscriber.on("message", async (channel: string, message: string) => {
        if (channel !== this.k.pubsub) return;
        let parsed: { event: string; taskId?: string } | null = null;
        try {
          parsed = JSON.parse(message);
        } catch {
          return;
        }
        if (!parsed?.taskId) return;
        if (parsed.event !== "task_completed" && parsed.event !== "task_failed") return;
        const waiter = this.waiters.get(parsed.taskId);
        if (!waiter) return;
        const raw = await this.client.hget(this.k.results, parsed.taskId);
        if (!raw) return;
        this.waiters.delete(parsed.taskId);
        clearTimeout(waiter.timer);
        waiter.resolve(JSON.parse(raw) as TaskResult);
      });
      this.subscribed = true;
    })();
    await this.subscribing;
  }

  async waitForResult(taskId: string, timeoutMs = 120_000): Promise<TaskResult> {
    const existing = await this.client.hget(this.k.results, taskId);
    if (existing) return JSON.parse(existing) as TaskResult;

    await this.ensureSubscribed();

    return new Promise<TaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(taskId);
        reject(new Error(`Timeout waiting for task result: ${taskId}`));
      }, timeoutMs);
      if (typeof (timer as any).unref === "function") (timer as any).unref();
      this.waiters.set(taskId, { resolve, reject, timer });
    });
  }

  async stats(): Promise<TaskQueueStats> {
    const pending = await this.client.llen(this.k.pending);
    const running = await this.client.scard(this.k.running);
    const completed = await this.client.hlen(this.k.results);
    return { pending, running, completed, failed: 0 };
  }

  async snapshot(limit = 100): Promise<{ tasks: Task[]; results: TaskResult[] }> {
    const tasksHash = await this.client.hgetall(this.k.tasks);
    const results = await this.client.hgetall(this.k.results);
    const tasks = Object.values(tasksHash)
      .map((v) => JSON.parse(v) as Task)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
    const resultList = tasks
      .map((t) => results[t.taskId])
      .filter((v): v is string => typeof v === "string")
      .map((v) => JSON.parse(v) as TaskResult);
    return { tasks, results: resultList };
  }
}
