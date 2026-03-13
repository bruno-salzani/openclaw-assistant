import type { Agent, AgentContext } from "../agents/types.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { Tracer } from "../observability/tracing.js";
import type { Task, TaskResult, TaskType } from "./task-types.js";
import type { TaskQueue } from "./task-queue.js";
import { randomUUID } from "node:crypto";

type AgentMap = Map<string, Agent>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TaskWorkerPool {
  private readonly queue: TaskQueue;

  private readonly agents: AgentMap;

  private readonly tracer: Tracer;

  private readonly metrics: MetricsRegistry;

  private readonly memory: MemorySystem;

  private running = false;

  private readonly nextWorkerIndexByKey = new Map<string, number>();

  private readonly workerCountByKey = new Map<string, number>();

  private readonly workerActiveByKey = new Map<string, number>();

  private readonly busyByKey = new Map<string, number>();

  constructor(params: {
    queue: TaskQueue;
    agents: Agent[];
    tracer: Tracer;
    metrics: MetricsRegistry;
    memory: MemorySystem;
  }) {
    this.queue = params.queue;
    this.agents = new Map(params.agents.map((a) => [a.role, a]));
    this.tracer = params.tracer;
    this.metrics = params.metrics;
    this.memory = params.memory;
  }

  registerAgent(agent: Agent) {
    this.agents.set(agent.role, agent);
  }

  start(concurrency: number, types: TaskType[]) {
    if (!this.running) this.running = true;
    const key = types.join("+");
    const startAt = this.nextWorkerIndexByKey.get(key) ?? 0;
    for (let i = 0; i < concurrency; i++) {
      const workerId = `${key}:${startAt + i}`;
      this.workerActiveByKey.set(key, (this.workerActiveByKey.get(key) ?? 0) + 1);
      this.loop(workerId, types)
        .catch(() => undefined)
        .finally(() => {
          this.workerActiveByKey.set(key, Math.max(0, (this.workerActiveByKey.get(key) ?? 1) - 1));
        });
    }
    this.nextWorkerIndexByKey.set(key, startAt + concurrency);
    this.workerCountByKey.set(key, (this.workerCountByKey.get(key) ?? 0) + concurrency);
  }

  stop() {
    this.running = false;
  }

  getWorkerCounts() {
    const byType: Record<string, number> = {};
    for (const [k, n] of this.workerActiveByKey.entries()) {
      const primary = String(k.split("+")[0] ?? "");
      if (!primary) continue;
      byType[primary] = (byType[primary] ?? 0) + Number(n ?? 0);
    }
    return byType;
  }

  getBusyCounts() {
    const byType: Record<string, number> = {};
    for (const [k, n] of this.busyByKey.entries()) {
      const primary = String(k.split("+")[0] ?? "");
      if (!primary) continue;
      byType[primary] = (byType[primary] ?? 0) + Number(n ?? 0);
    }
    return byType;
  }

  getBusyTotal() {
    let n = 0;
    for (const v of this.busyByKey.values()) n += Number(v ?? 0);
    return n;
  }

  private async loop(workerId: string, types: TaskType[]) {
    let idle = 0;
    while (this.running) {
      let task: Task | undefined;
      try {
        task = await this.queue.claimNext(types, workerId);
      } catch {
        await sleep(250);
        continue;
      }
      if (!task) {
        idle = Math.min((idle || 25) * 2, 500);
        await sleep(idle);
        continue;
      }
      idle = 0;
      try {
        const key = types.join("+");
        this.busyByKey.set(key, (this.busyByKey.get(key) ?? 0) + 1);
        await this.handleTask(workerId, task);
      } catch {
        await sleep(50);
      } finally {
        const key = types.join("+");
        this.busyByKey.set(key, Math.max(0, (this.busyByKey.get(key) ?? 1) - 1));
      }
    }
  }

  private async handleTask(workerId: string, task: Task) {
    const span = this.tracer.startSpan("tasks.worker.handle", {
      taskId: task.taskId,
      type: task.type,
      workerId,
    });
    const start = Date.now();
    try {
      this.metrics.counter("task_started_total").inc();
      const ctx: AgentContext = {
        sessionId: task.sessionId,
        userId: task.userId,
        userRole: task.userRole,
        channel: "task-queue",
        text: this.taskText(task),
        metadata: {
          ...(task.payload ?? {}),
          taskId: task.taskId,
          traceId: task.traceId,
          taskType: task.type,
          agentType: task.agentType,
          assignedNodeId: (task as any).assignedNodeId,
        },
      };

      if (typeof (this.memory as any).saveAgentState === "function") {
        try {
          await (this.memory as any).saveAgentState({
            taskId: task.taskId,
            agentName: task.agentType ?? task.type,
            step: "started",
            progress: 0.2,
            status: "running",
            context: { workerId },
            memoryRefs: [],
          });
        } catch {}
      }

      const agent = this.agentFor(task);
      const result = await agent.handle(ctx);
      const out: TaskResult = {
        taskId: task.taskId,
        traceId: task.traceId,
        ok: true,
        output: { text: result.text, meta: result.meta },
        meta: { latencyMs: Date.now() - start },
      };

      await this.memory.updateTask(task.taskId, "completed", out.output);
      if (typeof (this.memory as any).saveAgentState === "function") {
        try {
          await (this.memory as any).saveAgentState({
            taskId: task.taskId,
            agentName: task.agentType ?? task.type,
            step: "completed",
            progress: 1,
            status: "completed",
            context: out,
            memoryRefs: [],
          });
        } catch {}
      }
      this.metrics.counter("task_completed_total").inc();
      await this.queue.complete(out);
    } catch (err) {
      const out: TaskResult = {
        taskId: task.taskId,
        traceId: task.traceId,
        ok: false,
        error: { message: String(err) },
        meta: { latencyMs: Date.now() - start },
      };

      // Retry Logic (Exponential Backoff)
      const maxRetries = 3;
      const currentRetries = (task as any).retries ?? 0; // Assuming retries is on task object from DB/queue

      if (currentRetries < maxRetries) {
        await this.memory.incrementTaskRetry(task.taskId);
        await this.memory.updateTask(task.taskId, "failed", undefined, out.error);
        if (typeof (this.memory as any).saveAgentState === "function") {
          try {
            await (this.memory as any).saveAgentState({
              taskId: task.taskId,
              agentName: task.agentType ?? task.type,
              step: "retry_scheduled",
              progress: 1,
              status: "failed",
              context: { error: out.error, retry: currentRetries + 1, maxRetries },
              memoryRefs: [],
            });
          } catch {}
        }
        const delay = 2 ** currentRetries * 500;
        await sleep(delay);
        const newTask = {
          ...task,
          taskId: randomUUID(),
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          payload: { ...task.payload, retries: currentRetries + 1 },
        } as Task;
        await this.queue.enqueue(newTask);
        if (this.metrics.counter("task_retried_total")) {
          this.metrics.counter("task_retried_total").inc();
        } else {
          this.metrics.createCounter("task_retried_total", "Total number of task retries").inc();
        }
      } else {
        await this.memory.updateTask(task.taskId, "failed", undefined, out.error);
        if (typeof (this.memory as any).saveAgentState === "function") {
          try {
            await (this.memory as any).saveAgentState({
              taskId: task.taskId,
              agentName: task.agentType ?? task.type,
              step: "failed",
              progress: 1,
              status: "failed",
              context: out,
              memoryRefs: [],
            });
          } catch {}
        }
        this.metrics.counter("task_failed_total").inc();
      }

      await this.queue.fail(out);
    } finally {
      span.end();
    }
  }

  private agentFor(task: Task): Agent {
    if (task.agentType) {
      if (task.agentType === "document_parser") {
        const agent = this.agents.get("document");
        if (!agent) throw new Error("Document agent not available");
        return agent;
      }
      if (task.agentType === "notification_agent") {
        const agent = this.agents.get("notification");
        if (!agent) throw new Error("Notification agent not available");
        return agent;
      }
      if (task.agentType === "finance_agent") {
        const agent = this.agents.get("finance");
        if (!agent) throw new Error("Finance agent not available");
        return agent;
      }
      if (task.agentType === "reliability_agent") {
        const agent = this.agents.get("reliability");
        if (!agent) throw new Error("Reliability agent not available");
        return agent;
      }
      if (task.agentType === "curator_agent") {
        const agent = this.agents.get("curator");
        if (!agent) throw new Error("Knowledge curator agent not available");
        return agent;
      }
      if (task.agentType === "simulation_agent") {
        const agent = this.agents.get("simulation");
        if (!agent) throw new Error("Simulation agent not available");
        return agent;
      }
      if (task.agentType === "experiment_agent") {
        const agent = this.agents.get("experiment");
        if (!agent) throw new Error("Experiment agent not available");
        return agent;
      }
      if (task.agentType === "analysis_agent" || task.agentType === "database_agent") {
        const agent = this.agents.get("analyst");
        if (!agent) throw new Error("Analyst agent not available");
        return agent;
      }
    }
    if (task.type === "research") {
      const agent = this.agents.get("research");
      if (!agent) throw new Error("Research agent not available");
      return agent;
    }
    if (task.type === "execute") {
      const agent = this.agents.get("executor");
      if (!agent) throw new Error("Executor agent not available");
      return agent;
    }
    const agent = this.agents.get("analyst");
    if (!agent) throw new Error("Analyst agent not available");
    return agent;
  }

  private taskText(task: Task): string {
    if (task.type === "research") return String(task.payload.query ?? "");
    if (task.type === "execute") {
      const tool = String(task.payload.toolName ?? "");
      const args = String(task.payload.args ?? "");
      return `tool: ${tool} ${args}`.trim();
    }
    return "analyze";
  }
}
