import type { AgentDeps } from "../../agents/agent-deps.js";

export type ModelInfo = {
  id: string;
  createdAt: number;
  tags?: string[];
  metrics?: Record<string, number>;
};

export class ModelRegistry {
  private models: ModelInfo[] = [];

  constructor(private readonly deps: AgentDeps) {}

  async register(info: ModelInfo) {
    this.models.push(info);
    await this.deps.memory.add("ontology", JSON.stringify(info), { type: "model_info" });
  }

  list() {
    return [...this.models];
  }
}
