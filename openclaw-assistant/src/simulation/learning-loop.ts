import type { MetricsRegistry } from "../observability/metrics.js";
import { computeReward } from "./reward-system.js";

export class SimulationLearningLoop {
  constructor(private readonly deps: { metrics: MetricsRegistry }) {
    this.deps.metrics.createHistogram(
      "simulation_reward",
      "Reward signal computed from simulation runs"
    );
  }

  onRunComplete(params: { ok: boolean; latencyMs?: number; tokens?: number; toolSuccessRate?: number }) {
    const r = computeReward(params);
    this.deps.metrics.histogram("simulation_reward").observe(r.reward);
    return r;
  }
}

