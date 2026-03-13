import type { AgentDeps } from "../agents/agent-deps.js";
import type { Agent } from "../agents/types.js";
import { AgentFactory } from "../agents/factory.js";
import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { TaskWorkerPool } from "../tasks/worker-pool.js";
import type { AgentRegistry } from "./agent-registry.js";
import type { AgentBlueprint } from "./types.js";

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export class AgentDeployer {
  private readonly factory: AgentFactory;

  constructor(
    private readonly deps: {
      agentDeps: AgentDeps;
      orchestrator: AgentOrchestrator;
      workerPool?: TaskWorkerPool;
      registry?: AgentRegistry;
    }
  ) {
    this.factory = new AgentFactory(this.deps.agentDeps);
  }

  deployFromBlueprint(params: { blueprint: AgentBlueprint; role?: string; version?: string }): Agent {
    const bp = params.blueprint;
    const permissions = uniq([...bp.tools, ...bp.skills, ...bp.capabilities]).slice(0, 200);
    const spec = {
      id: bp.name,
      role: params.role ?? "automation",
      capabilities: permissions,
      systemPrompt: bp.description,
    };
    const agent = this.factory.createAgent(spec as any);
    this.deps.orchestrator.registerAgent(agent);
    this.deps.workerPool?.registerAgent(agent);
    if (this.deps.registry) {
      this.deps.registry.upsert({
        name: bp.name,
        version: params.version ?? "0.1.0",
        description: bp.description,
        capabilities: uniq(bp.capabilities),
        tools: uniq(bp.tools),
        skills: uniq(bp.skills),
      } as any);
    }
    return agent;
  }
}

