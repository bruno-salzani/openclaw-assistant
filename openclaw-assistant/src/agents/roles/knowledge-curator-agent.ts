import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";
import { UniversalKnowledgeSystem } from "../../posthuman/universal-knowledge.js";

export class KnowledgeCuratorAgent implements Agent {
  role: Agent["role"] = "curator";

  private readonly knowledge: UniversalKnowledgeSystem;

  constructor(private readonly deps: AgentDeps) {
    this.knowledge = new UniversalKnowledgeSystem(deps);
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const m = ctx.text.match(/store\s+(model|law|strategy)\s*:\s*(.+)/i);
    if (m) {
      const kind = m[1].toLowerCase();
      const payload = m[2];
      const id = `curator-${Date.now()}`;
      if (kind === "model") await this.knowledge.storeModel(id, payload);
      else if (kind === "law") await this.knowledge.storeLaw(id, payload);
      else await this.knowledge.storeStrategy(id, payload);
      return { text: JSON.stringify({ stored: kind, id }) };
    }
    const q = ctx.text.replace(/^curate\s*/i, "").trim();
    const results = await this.knowledge.search(q || "general", 5);
    return { text: JSON.stringify({ results }) };
  }
}
