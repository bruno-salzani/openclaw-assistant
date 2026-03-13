import type { TaskQueue } from "../tasks/task-queue.js";
import type { Task, TaskResult, TaskType } from "../tasks/task-types.js";
import type { EventBus } from "../infra/event-bus.js";
import type { NodeRegistry } from "./node-registry.js";
import { LoadBalancer } from "./load-balancer.js";

export class DistributedTaskDispatcher implements TaskQueue {
  constructor(
    private readonly deps: {
      base: TaskQueue;
      registry: NodeRegistry;
      bus?: EventBus;
      role?: "worker";
      strategy?: "least_busy" | "random";
      staleMs?: number;
      workerNodeId?: string;
      enforceAssignment?: boolean;
    }
  ) {}

  async enqueue(task: Task): Promise<void> {
    const shouldAssign = String(process.env.IA_ASSISTANT_CLUSTER_ASSIGN_TASKS ?? "1") !== "0";
    if (shouldAssign && !task.assignedNodeId) {
      try {
        const nodes = await this.deps.registry.list({ role: "worker", staleMs: this.deps.staleMs });
        const lb = new LoadBalancer({ strategy: this.deps.strategy });
        const picked = lb.pickNode({ nodes, role: "worker", type: task.type });
        if (picked) {
          const assigned = { ...task, assignedNodeId: picked.nodeId } as Task;
          this.deps.bus?.emit("cluster.task.assigned", {
            taskId: assigned.taskId,
            type: assigned.type,
            assignedNodeId: assigned.assignedNodeId,
            traceId: assigned.traceId,
          });
          await this.deps.base.enqueue(assigned);
          return;
        }
      } catch {}
    }
    await this.deps.base.enqueue(task);
  }

  async claimNext(types: TaskType[], workerId: string): Promise<Task | undefined> {
    const t = await this.deps.base.claimNext(types, workerId);
    if (!t) return undefined;
    if (!this.deps.enforceAssignment) return t;
    const nodeId = this.deps.workerNodeId ?? "";
    const assigned = String((t as any).assignedNodeId ?? "");
    if (!assigned || !nodeId || assigned === nodeId) return t;
    const requeued: Task = { ...t, status: "pending", updatedAt: Date.now() };
    await this.deps.base.enqueue(requeued);
    return undefined;
  }

  complete(result: TaskResult): Promise<void> {
    return this.deps.base.complete(result);
  }

  fail(result: TaskResult): Promise<void> {
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

