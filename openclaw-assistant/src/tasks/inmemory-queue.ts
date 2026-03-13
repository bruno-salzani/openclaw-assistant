import { EventEmitter } from "node:events";
import type { Task, TaskResult, TaskType } from "./task-types.js";
import type { TaskQueue, TaskQueueStats } from "./task-queue.js";

function now() {
  return Date.now();
}

function priorityScore(p: Task["priority"]) {
  if (p === "high") return 3;
  if (p === "medium") return 2;
  return 1;
}

export class InMemoryTaskQueue implements TaskQueue {
  private readonly events = new EventEmitter();

  private readonly tasks = new Map<string, Task>();

  private readonly results = new Map<string, TaskResult>();

  private readonly pendingSet = new Set<string>();

  private readonly pendingHeap: Array<{ taskId: string; score: number; seq: number }> = [];

  private seq = 0;

  private heapPush(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const node = { taskId, score: priorityScore(task.priority), seq: ++this.seq };
    this.pendingHeap.push(node);
    let i = this.pendingHeap.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      const a = this.pendingHeap[i];
      const b = this.pendingHeap[p];
      if (a.score > b.score || (a.score === b.score && a.seq > b.seq)) {
        this.pendingHeap[i] = b;
        this.pendingHeap[p] = a;
        i = p;
      } else {
        break;
      }
    }
  }

  private heapPop(): { taskId: string; score: number; seq: number } | undefined {
    const top = this.pendingHeap[0];
    if (!top) return undefined;
    const last = this.pendingHeap.pop();
    if (this.pendingHeap.length > 0 && last) {
      this.pendingHeap[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let best = i;
        const a = this.pendingHeap[best];
        const left = this.pendingHeap[l];
        const right = this.pendingHeap[r];
        if (left && (left.score > a.score || (left.score === a.score && left.seq > a.seq)))
          best = l;
        const b2 = this.pendingHeap[best];
        if (right && (right.score > b2.score || (right.score === b2.score && right.seq > b2.seq)))
          best = r;
        if (best === i) break;
        const tmp = this.pendingHeap[i];
        this.pendingHeap[i] = this.pendingHeap[best];
        this.pendingHeap[best] = tmp;
        i = best;
      }
    }
    return top;
  }

  async enqueue(task: Task): Promise<void> {
    const existing = this.tasks.get(task.taskId);
    this.tasks.set(task.taskId, task);
    if (task.status === "pending") {
      this.pendingSet.add(task.taskId);
      const shouldReheap =
        !existing || existing.status !== "pending" || existing.priority !== task.priority;
      if (shouldReheap) this.heapPush(task.taskId);
    }
    this.events.emit("task_enqueued", task.taskId);
  }

  async claimNext(types: TaskType[], workerId: string): Promise<Task | undefined> {
    const buffer: string[] = [];
    const max = Math.min(50, this.pendingHeap.length);
    for (let i = 0; i < max; i++) {
      const node = this.heapPop();
      if (!node) break;
      const task = this.tasks.get(node.taskId);
      if (!task || task.status !== "pending" || !this.pendingSet.has(node.taskId)) continue;
      const currentScore = priorityScore(task.priority);
      if (node.score !== currentScore) {
        this.heapPush(node.taskId);
        continue;
      }
      if (!types.includes(task.type)) {
        buffer.push(node.taskId);
        continue;
      }
      this.pendingSet.delete(node.taskId);
      const updated: Task = { ...task, status: "running", updatedAt: now() };
      this.tasks.set(node.taskId, updated);
      this.events.emit("task_started", { taskId: node.taskId, workerId });
      for (const id of buffer) this.heapPush(id);
      return updated;
    }
    for (const id of buffer) this.heapPush(id);
    return undefined;
  }

  async complete(result: TaskResult): Promise<void> {
    this.results.set(result.taskId, result);
    const task = this.tasks.get(result.taskId);
    if (task) {
      this.pendingSet.delete(result.taskId);
      this.tasks.set(result.taskId, { ...task, status: "completed", updatedAt: now() });
    }
    this.events.emit(`task_result:${result.taskId}`, result);
    this.events.emit("task_completed", result);
  }

  async fail(result: TaskResult): Promise<void> {
    this.results.set(result.taskId, result);
    const task = this.tasks.get(result.taskId);
    if (task) {
      this.pendingSet.delete(result.taskId);
      this.tasks.set(result.taskId, { ...task, status: "failed", updatedAt: now() });
    }
    this.events.emit(`task_result:${result.taskId}`, result);
    this.events.emit("task_failed", result);
  }

  async waitForResult(taskId: string, timeoutMs = 120_000): Promise<TaskResult> {
    const existing = this.results.get(taskId);
    if (existing) return existing;

    return new Promise<TaskResult>((resolve, reject) => {
      const self = this;
      let timer: ReturnType<typeof setTimeout> | null = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        self.events.off(`task_result:${taskId}`, onResult);
      }

      function onResult(result: TaskResult) {
        cleanup();
        resolve(result);
      }

      function onTimeout() {
        cleanup();
        reject(new Error(`Timeout waiting for task result: ${taskId}`));
      }

      timer = setTimeout(onTimeout, timeoutMs);
      if (typeof (timer as any).unref === "function") (timer as any).unref();
      self.events.on(`task_result:${taskId}`, onResult);
    });
  }

  async stats(): Promise<TaskQueueStats> {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "pending") pending++;
      else if (t.status === "running") running++;
      else if (t.status === "completed") completed++;
      else failed++;
    }
    return { pending, running, completed, failed };
  }

  async snapshot(limit = 100): Promise<{ tasks: Task[]; results: TaskResult[] }> {
    const tasks = [...this.tasks.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
    const results = tasks
      .map((t) => this.results.get(t.taskId))
      .filter((r): r is TaskResult => !!r);
    return { tasks, results };
  }

  on(event: "task_started" | "task_completed" | "task_failed", listener: (payload: any) => void) {
    this.events.on(event, listener);
  }
}
