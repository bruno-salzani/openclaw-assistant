import type { AgentDeps } from "../agents/agent-deps.js";
import type { MemoryEntry } from "../memory/memory-types.js";

export class UniversalKnowledgeSystem {
  constructor(private readonly deps: AgentDeps) {}

  async search(topic: string, limit = 5): Promise<MemoryEntry[]> {
    const results = await this.deps.memory.search(topic, { limit, type: "semantic" });
    return results;
  }

  async storeModel(name: string, content: string) {
    await this.deps.memory.add("ontology", `[MODEL] ${name}: ${content}`, {
      kind: "universal_model",
    });
  }

  async storeLaw(name: string, content: string) {
    await this.deps.memory.add("ontology", `[LAW] ${name}: ${content}`, { kind: "scientific_law" });
  }

  async storeStrategy(name: string, content: string) {
    await this.deps.memory.add("procedural", `[STRATEGY] ${name}: ${content}`, {
      kind: "strategy",
    });
  }

  async archiveSimulation(simName: string, result: any) {
    await this.deps.memory.add("long-term", `[SIM] ${simName}`, {
      kind: "simulation_archive",
      result: JSON.stringify(result),
    });
  }
}
