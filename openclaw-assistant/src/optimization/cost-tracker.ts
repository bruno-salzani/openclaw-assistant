import type { EventBus } from "../infra/event-bus.js";

export type CostSnapshot = {
  totalUsd: number;
  runs: number;
  avgUsdPerRun: number;
};

export class CostTracker {
  private totalUsd = 0;

  private runs = 0;

  constructor(private readonly deps: { bus: EventBus }) {}

  start() {
    this.deps.bus.on("ai.observability", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      const cost = Number(evt.costUsd ?? 0);
      if (!Number.isFinite(cost) || cost < 0) return;
      this.totalUsd += cost;
      this.runs += 1;
    });
  }

  snapshot(): CostSnapshot {
    const runs = this.runs;
    const totalUsd = this.totalUsd;
    const avgUsdPerRun = runs > 0 ? totalUsd / runs : 0;
    return { totalUsd, runs, avgUsdPerRun };
  }
}
