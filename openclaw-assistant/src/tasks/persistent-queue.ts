import type { MemorySystem } from "../memory/memory-system.js";
import type { TaskQueue } from "./task-queue.js";
import type { Task, TaskResult, TaskType } from "./task-types.js";

export class PersistentTaskQueue implements TaskQueue {
  constructor(
    private readonly deps: {
      base: TaskQueue;
      memory: MemorySystem;
    }
  ) {}

  async enqueue(task: Task): Promise<void> {
    await this.deps.memory.logTask(task);
    await this.deps.memory.saveAgentState({
      taskId: task.taskId,
      agentName: task.agentType ?? task.type,
      step: "enqueued",
      progress: 0,
      status: "pending",
      context: task,
      memoryRefs: [],
    });
    return this.deps.base.enqueue(task);
  }

  async claimNext(types: TaskType[], workerId: string): Promise<Task | undefined> {
    const task = await this.deps.base.claimNext(types, workerId);
    if (!task) return undefined;
    await this.deps.memory.updateTask(task.taskId, "running");
    await this.deps.memory.saveAgentState({
      taskId: task.taskId,
      agentName: task.agentType ?? task.type,
      step: "claimed",
      progress: 0.1,
      status: "running",
      context: { workerId, types },
      memoryRefs: [],
    });
    return task;
  }

  async complete(result: TaskResult): Promise<void> {
    return this.deps.base.complete(result);
  }

  async fail(result: TaskResult): Promise<void> {
    return this.deps.base.fail(result);
  }

  waitForResult(taskId: string, timeoutMs?: number): Promise<TaskResult> {
    return this.deps.base.waitForResult(taskId, timeoutMs);
  }

  stats() {
    return this.deps.base.stats();
  }

  snapshot(limit?: number) {
    return this.deps.base.snapshot(limit);
  }
}
