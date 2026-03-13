import type { AgentDeps } from "../agents/agent-deps.js";
import { MultiRealitySimulationSystem } from "./simulation.js";
import { UniversalKnowledgeSystem } from "./universal-knowledge.js";

export class KnowledgeDiscoveryEngine {
  private readonly sim: MultiRealitySimulationSystem;

  private readonly knowledge: UniversalKnowledgeSystem;

  constructor(private readonly deps: AgentDeps) {
    this.sim = new MultiRealitySimulationSystem(deps);
    this.knowledge = new UniversalKnowledgeSystem(deps);
    this.deps.metrics.createCounter("discoveries_total", "Total discoveries recorded");
  }

  async discover(topic: string) {
    const collected = await this.knowledge.search(topic, 8);
    const hypotheses = this.generateHypotheses(
      topic,
      collected.map((e) => e.content)
    );
    const experiments = this.designExperiments(hypotheses);
    const results: any[] = [];
    for (const ex of experiments) {
      const out = await this.sim.run(ex.model, ex.params);
      results.push({ hypothesis: ex.hypothesis, result: out });
      await this.knowledge.archiveSimulation(ex.model, out);
    }
    const findings = this.analyze(results);
    for (const f of findings) {
      await this.knowledge.storeModel(`${topic}:${f.label}`, f.model);
      await this.knowledge.storeStrategy(`${topic}:${f.label}`, f.strategy);
    }
    this.deps.metrics.counter("discoveries_total").inc();
    return { topic, hypotheses, findings };
  }

  private generateHypotheses(topic: string, contexts: string[]) {
    const base = topic.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join("-");
    return contexts.slice(0, 3).map((c, i) => `${base}-h${i + 1}-${Math.abs(c.length % 97)}`);
  }

  private designExperiments(hypotheses: string[]) {
    return hypotheses.map((h, i) => {
      const even = i % 2 === 0;
      return {
        hypothesis: h,
        model: even ? "economy.global" : "climate.planet",
        params: even ? { cycles: 12, initialGDP: 120 } : { years: 15, initialTemp: 1.2 },
      };
    });
  }

  private analyze(results: Array<{ hypothesis: string; result: any }>) {
    return results.map((r) => ({
      label: r.hypothesis,
      model: JSON.stringify(r.result),
      strategy: r.result.gdp !== undefined ? "counter-cyclical policy" : "adaptation focus",
    }));
  }
}
