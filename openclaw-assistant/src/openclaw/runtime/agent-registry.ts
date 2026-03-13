import type { AgentDeps } from "../../agents/agent-deps.js";
import type { Agent, AgentContext } from "../../agents/types.js";
import { PlannerAgent } from "../../agents/roles/planner-agent.js";
import { CoordinatorAgent } from "../../agents/roles/coordinator-agent.js";

import type { OpenClawAgent } from "./runtime-adapter.js";

function wrapAgent(agent: Agent): OpenClawAgent {
  return {
    name: agent.role,
    execute: async (input: { taskId: string; context: any }) => {
      const ctx = input.context as AgentContext;
      const res = await agent.handle(ctx);
      return { text: res.text, meta: res.meta };
    },
  };
}

export function buildOpenClawAgentRegistry(deps: AgentDeps): Record<string, OpenClawAgent> {
  const planner = wrapAgent(new PlannerAgent(deps));
  const coordinator = wrapAgent(new CoordinatorAgent(deps));
  return {
    planner,
    coordinator,
  };
}
