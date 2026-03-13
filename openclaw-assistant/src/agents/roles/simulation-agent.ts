import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";
import { MultiRealitySimulationSystem } from "../../posthuman/simulation.js";

export class SimulationAgent implements Agent {
  role: Agent["role"] = "simulation";

  private readonly sim: MultiRealitySimulationSystem;

  constructor(private readonly deps: AgentDeps) {
    this.sim = new MultiRealitySimulationSystem(deps);
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const t = ctx.text.toLowerCase();
    const model = t.includes("econom") ? "economy.global" : "climate.planet";
    const params = t.includes("econom")
      ? { cycles: 12, initialGDP: 120 }
      : { years: 10, initialTemp: 1.1 };
    const out = await this.sim.run(model, params);
    return { text: JSON.stringify({ model, params, out }) };
  }
}
