import type { TaskStore } from "./task-store.js";

export interface OpenClawAgent {
  name: string;
  execute(input: { taskId: string; context: any }): Promise<any>;
}

export class OpenClawRuntime {
  constructor(
    private readonly deps: {
      agents: Record<string, OpenClawAgent>;
      store: TaskStore;
    }
  ) {}

  async run(agentName: string, input: { taskId: string; context: any }) {
    const agent = this.deps.agents[agentName];
    if (!agent) throw new Error("Agent not found");

    const existing = this.deps.store.get(input.taskId);
    if (!existing) {
      this.deps.store.save({
        id: input.taskId,
        agentName,
        context: input.context,
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    this.deps.store.update(input.taskId, {
      status: "running",
      attempts: (existing?.attempts ?? 0) + 1,
    });

    try {
      const output = await agent.execute(input);
      this.deps.store.update(input.taskId, { status: "completed", output, error: undefined });
      return output;
    } catch (err) {
      this.deps.store.update(input.taskId, {
        status: "failed",
        error: String((err as any)?.message ?? err),
      });
      throw err;
    }
  }

  async resume(taskId: string) {
    const task = this.deps.store.get(taskId);
    if (!task) throw new Error("Task not found");
    if (task.status === "completed") return task.output;
    return this.run(task.agentName, { taskId: task.id, context: task.context });
  }
}
