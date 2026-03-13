import type { AgentDeps } from "../../agents/agent-deps.js";

export type Interaction = {
  ts: number;
  agent: string;
  input: string;
  output?: string;
  ok?: boolean;
  tags?: string[];
};

export class InteractionCollector {
  constructor(private readonly deps: AgentDeps) {}

  async record(i: Interaction) {
    await this.deps.memory.add("episodic", JSON.stringify(i), { type: "interaction" });
  }
}
