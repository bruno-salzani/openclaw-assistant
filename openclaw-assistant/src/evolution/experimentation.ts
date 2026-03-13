import type { AgentDeps } from "../agents/agent-deps.js";

export type Experiment = {
  id: string;
  name: string;
  variants: string[]; // e.g., ["strategy_A", "strategy_B"]
  metrics: string[]; // e.g., ["time", "quality"]
  status: "running" | "completed";
  results: Record<string, any>;
};

export class ExperimentationEngine {
  private experiments: Map<string, Experiment> = new Map();

  constructor(private readonly deps: AgentDeps) {}

  createExperiment(name: string, variants: string[], metrics: string[]) {
    const id = `exp-${Date.now()}`;
    const experiment: Experiment = {
      id,
      name,
      variants,
      metrics,
      status: "running",
      results: {},
    };
    this.experiments.set(id, experiment);
    this.deps.memory.add("event", `Started experiment: ${name}`, { experimentId: id, variants });
    return id;
  }

  selectVariant(experimentId: string): string {
    const exp = this.experiments.get(experimentId);
    if (!exp) return "control";
    // Simple random assignment for A/B testing
    return exp.variants[Math.floor(Math.random() * exp.variants.length)];
  }

  async recordResult(experimentId: string, variant: string, metrics: Record<string, number>) {
    const exp = this.experiments.get(experimentId);
    if (!exp) return;

    if (!exp.results[variant]) {
      exp.results[variant] = { count: 0, metrics: {} };
    }

    exp.results[variant].count++;
    for (const [key, value] of Object.entries(metrics)) {
      const current = exp.results[variant].metrics[key] || 0;
      exp.results[variant].metrics[key] = current + value; // Simple sum, needs average later
    }

    await this.deps.memory.add("event", `Experiment result recorded`, {
      experimentId,
      variant,
      metrics,
    });
  }

  analyzeResults(experimentId: string) {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;

    // Simple analysis: return variant with best metric (assuming lower is better for time, higher for quality)
    // For now, just return raw data
    return exp.results;
  }
}
