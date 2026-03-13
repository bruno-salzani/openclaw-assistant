import type { AgentDeps } from "../agents/agent-deps.js";

export type ReasoningMode = "parallel" | "probabilistic" | "emergent";

type Kernel = {
  id: string;
  weights: Record<string, number>;
};

export class PostHumanCognitiveLayer {
  private kernels: Kernel[] = [];

  constructor(private readonly deps: AgentDeps) {
    this.deps.metrics.createCounter("reasoning_graph_runs_total", "Total reasoning graph runs");
  }

  addKernel(kernel: Kernel) {
    this.kernels.push(kernel);
  }

  run(input: { concepts: string[] }): { mode: ReasoningMode; branches: string[][] } {
    const distinct = Array.from(new Set(input.concepts));
    let mode: ReasoningMode = "parallel";
    if (distinct.length > 12) mode = "emergent";
    else if (distinct.length > 6) mode = "probabilistic";
    const branches: string[][] = [];
    const stride = Math.max(1, Math.floor(distinct.length / 4));
    for (let i = 0; i < distinct.length; i += stride) {
      branches.push(distinct.slice(i, i + stride));
    }
    this.deps.metrics.counter("reasoning_graph_runs_total").inc();
    return { mode, branches };
  }
}
