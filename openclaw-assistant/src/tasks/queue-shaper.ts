import type { AgentDeps } from "../agents/agent-deps.js";

export class QueueShaper {
  private last = 0;

  constructor(private readonly deps: AgentDeps) {}

  async tick() {
    const now = Date.now();
    if (now - this.last < 15000) return;
    const snapshot = await this.deps.queue.snapshot(100);
    for (const t of snapshot.tasks) {
      const age = now - t.createdAt;
      if (t.status === "pending" && age > 60000 && t.priority !== "high") {
        const bumped = { ...t, priority: "high" as const, updatedAt: now };
        await this.deps.queue.enqueue(bumped);
        this.deps.metrics
          .createCounter("tasks_priority_bumped_total", "Tasks bumped to high priority")
          .inc();
      }
    }
    this.last = now;
  }
}
