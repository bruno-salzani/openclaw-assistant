import type { AgentDeps } from "../agents/agent-deps.js";
import type { TaskType } from "./task-types.js";

export class WorkerAutoscaler {
  private lastScale = 0;

  constructor(
    private readonly deps: AgentDeps,
    private readonly pool: {
      start: (n: number, types: TaskType[]) => void;
      getWorkerCounts?: () => Record<string, number>;
    }
  ) {}

  async tick() {
    const now = Date.now();
    if (now - this.lastScale < 30_000) return;
    const threshold = Number(process.env.OPENCLAW_X_AUTOSCALE_PENDING_THRESHOLD ?? 10);
    const maxResearch = Number(process.env.OPENCLAW_X_AUTOSCALE_MAX_RESEARCH_WORKERS ?? 8);
    const maxExecute = Number(process.env.OPENCLAW_X_AUTOSCALE_MAX_EXECUTE_WORKERS ?? 6);
    const maxAnalyze = Number(process.env.OPENCLAW_X_AUTOSCALE_MAX_ANALYZE_WORKERS ?? 4);

    const snapshot = await this.deps.queue.snapshot(200);
    const pendingByType = new Map<TaskType, number>();
    for (const t of snapshot.tasks) {
      if (t.status !== "pending") continue;
      pendingByType.set(t.type, (pendingByType.get(t.type) ?? 0) + 1);
    }

    const counts = this.pool.getWorkerCounts?.() ?? {};
    const counter =
      this.deps.metrics.counter("workers_scaled_total") ??
      this.deps.metrics.createCounter(
        "workers_scaled_total",
        "Total number of worker scale-up events"
      );

    const plan: Array<{ type: TaskType; max: number }> = [
      { type: "research", max: maxResearch },
      { type: "execute", max: maxExecute },
      { type: "analyze", max: maxAnalyze },
    ];

    for (const p of plan) {
      const pending = pendingByType.get(p.type) ?? 0;
      if (pending <= threshold) continue;
      const key = p.type;
      const current = Number(counts[key] ?? 0);
      const desired = Math.min(p.max, Math.max(current, Math.ceil(pending / threshold)));
      const delta = desired - current;
      if (delta <= 0) continue;
      this.pool.start(delta, [p.type]);
      counter.inc(delta);
    }
    this.lastScale = now;
  }
}
