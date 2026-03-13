import type { AgentDeps } from "../../agents/agent-deps.js";

export type EvalMetric = {
  name: string;
  value: number;
};

export class Evaluator {
  constructor(private readonly deps: AgentDeps) {}

  async evaluate(_samples: Array<{ input: string; output: string }>): Promise<EvalMetric[]> {
    const quality = Math.max(0, Math.min(1, Math.random()));
    const latency = Math.random() * 2;
    await this.deps.memory.add("event", "continual_eval", { quality, latency });
    return [
      { name: "quality", value: quality },
      { name: "latency", value: latency },
    ];
  }
}
