import type { AgentDeps } from "../agents/agent-deps.js";
import { UniversalKnowledgeSystem } from "./universal-knowledge.js";
import { ArchitectureEvolutionEngine } from "../evolution/architecture.js";
import { MetaIntelligenceLayer } from "./meta-intelligence.js";
import { MultiRealitySimulationSystem } from "./simulation.js";

export class IntelligenceEvolutionCycle {
  private readonly knowledge: UniversalKnowledgeSystem;

  private readonly arch: ArchitectureEvolutionEngine;

  private readonly meta: MetaIntelligenceLayer;

  private readonly sim: MultiRealitySimulationSystem;

  constructor(
    private readonly deps: AgentDeps,
    meta: MetaIntelligenceLayer
  ) {
    this.knowledge = new UniversalKnowledgeSystem(deps);
    this.arch = new ArchitectureEvolutionEngine(deps);
    this.meta = meta;
    this.sim = new MultiRealitySimulationSystem(deps);
    this.deps.metrics.createCounter(
      "intelligence_cycles_total",
      "Total intelligence evolution cycles"
    );
  }

  async run(topic: string) {
    await this.knowledge.search(topic, 5);
    await this.arch.evolve();
    await this.meta.designNewCognitiveKernel();
    const perf = await this.sim.run("economy.global", { cycles: 6 });
    await this.deps.memory.add("event", "intelligence_cycle_perf", { perf });
    await this.deps.memory.add("event", "intelligence_global_deploy", {
      topic,
      status: "rolled_out",
    });
    this.deps.metrics.counter("intelligence_cycles_total").inc();
  }
}
