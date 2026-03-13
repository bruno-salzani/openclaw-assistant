import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class ReliabilityAgent implements Agent {
  role: Agent["role"] = "reliability";

  constructor(private readonly deps: AgentDeps) {}

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const toolMatch = ctx.text.match(/diagnose\s+tool\s+([a-z0-9._-]+)/i);
    const tool = toolMatch ? toolMatch[1] : undefined;
    const stats = await this.deps.queue.stats();
    const info = { queue: stats, tool };
    await this.deps.memory.add("event", "reliability_diagnosis", info as any);
    return { text: JSON.stringify({ diagnosis: "ok", info }) };
  }
}
