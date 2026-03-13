import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";
import { ExperimentationEngine } from "../../evolution/experimentation.js";

export class ExperimentAgent implements Agent {
  role: Agent["role"] = "experiment";

  private readonly exp: ExperimentationEngine;

  constructor(private readonly deps: AgentDeps) {
    this.exp = new ExperimentationEngine(deps);
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const parts = ctx.text.split(/\s+/);
    const name = parts[1] ?? `exp-${Date.now()}`;
    const variants = ["A", "B"];
    const metrics = ["quality", "latency"];
    const id = this.exp.createExperiment(name, variants, metrics);
    const selected = this.exp.selectVariant(id);
    await this.deps.memory.add("event", "experiment_created", { id, name, selected });
    return { text: JSON.stringify({ id, selected }) };
  }
}
