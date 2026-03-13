import type { Task, TaskResult, TaskType } from "./task-types.js";

export type TaskQueueStats = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
};

export interface TaskQueue {
  enqueue(task: Task): Promise<void>;
  claimNext(types: TaskType[], workerId: string): Promise<Task | undefined>;
  complete(result: TaskResult): Promise<void>;
  fail(result: TaskResult): Promise<void>;
  waitForResult(taskId: string, timeoutMs?: number): Promise<TaskResult>;
  stats(): Promise<TaskQueueStats>;
  snapshot(limit?: number): Promise<{ tasks: Task[]; results: TaskResult[] }>;
}
