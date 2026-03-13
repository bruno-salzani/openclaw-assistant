import type { Agent, AgentContext, AgentResult } from "./types.js";
import type { AgentDeps } from "./agent-deps.js";

export type CustomAgentSpec = {
  id: string;
  role: string;
  capabilities: string[];
  systemPrompt: string;
};

export class CustomAgent implements Agent {
  role: Agent["role"];

  private readonly spec: CustomAgentSpec;

  private readonly deps: AgentDeps;

  constructor(spec: CustomAgentSpec, deps: AgentDeps) {
    this.role = spec.role as Agent["role"];
    this.spec = spec;
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan(`agent.custom.${this.spec.id}`, {
      sessionId: ctx.sessionId,
    });
    try {
      if (this.deps.llm) {
        const out = await this.deps.llm.chat({
          messages: [
            { role: "system", content: this.spec.systemPrompt || `You are agent ${this.spec.id}.` },
            { role: "user", content: ctx.text },
          ],
          temperature: 0.3,
          maxTokens: 1200,
        });
        return { text: String(out ?? ""), meta: { agentId: this.spec.id, role: this.role } };
      }
      return { text: `[Custom Agent ${this.spec.id}] ${ctx.text}`, meta: { agentId: this.spec.id, role: this.role } };
    } finally {
      span.end();
    }
  }
}

export class AgentFactory {
  constructor(private readonly deps: AgentDeps) {}

  createAgent(spec: CustomAgentSpec): Agent {
    // Register permissions for the new agent
    if (this.deps.permissions) {
      this.deps.permissions.grant(spec.id, spec.capabilities);
    }

    return new CustomAgent(spec, this.deps);
  }
}
