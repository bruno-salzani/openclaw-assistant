import type { Agent } from "../agents/types.js";
import { AgentFactory, type CustomAgentSpec } from "../agents/factory.js";
import type { AgentDeps } from "../agents/agent-deps.js";

export type AgentGenerationResult = {
  ok: boolean;
  created: Array<{ id: string; role: string }>;
};

export async function generateAgents(params: {
  deps: AgentDeps;
  specs: CustomAgentSpec[];
  registerAgent: (agent: Agent) => void;
}): Promise<AgentGenerationResult> {
  const specs = Array.isArray(params.specs) ? params.specs : [];
  const factory = new AgentFactory(params.deps);
  const created: Array<{ id: string; role: string }> = [];

  for (const spec of specs.slice(0, 12)) {
    const agent = factory.createAgent(spec);
    params.registerAgent(agent);
    created.push({ id: spec.id, role: agent.role });
  }

  return { ok: true, created };
}

