import type { AgentDeps } from "../agents/agent-deps.js";

type SimulationModel = {
  id: string;
  run: (params: Record<string, any>) => Promise<any>;
};

export class MultiRealitySimulationSystem {
  private readonly models = new Map<string, SimulationModel>();

  constructor(private readonly deps: AgentDeps) {
    this.deps.metrics.createCounter("simulation_runs_total", "Total simulation runs");
    this.registerBuiltins();
  }

  private registerBuiltins() {
    this.register({
      id: "economy.global",
      run: async (params) => {
        const cycles = Number(params.cycles ?? 10);
        let gdp = Number(params.initialGDP ?? 100);
        for (let i = 0; i < cycles; i++) {
          gdp *= 1 + (Math.random() * 0.04 - 0.01);
        }
        return { gdp: +gdp.toFixed(2), cycles };
      },
    });
    this.register({
      id: "climate.planet",
      run: async (params) => {
        const years = Number(params.years ?? 10);
        let temp = Number(params.initialTemp ?? 1.1);
        for (let y = 0; y < years; y++) {
          temp += Math.random() * 0.02 + 0.01;
        }
        return { anomalyC: +temp.toFixed(3), years };
      },
    });
  }

  register(model: SimulationModel) {
    this.models.set(model.id, model);
  }

  async run(modelId: string, params: Record<string, any>) {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Unknown simulation model: ${modelId}`);
    const out = await model.run(params);
    this.deps.metrics.counter("simulation_runs_total").inc();
    return out;
  }
}
