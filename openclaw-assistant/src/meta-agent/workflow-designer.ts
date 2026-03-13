import type { CustomAgentSpec } from "../agents/factory.js";

export type DesignedWorkflow = {
  goal: string;
  nodes: Array<{ id: string; role: string; prompt: string }>;
  edges: Array<{ from: string; to: string }>;
};

export function designWorkflow(params: { goal: string; agents: CustomAgentSpec[] }): DesignedWorkflow {
  const goal = String(params.goal ?? "").trim();
  const agents = Array.isArray(params.agents) ? params.agents : [];
  const nodes = agents.map((a) => ({
    id: a.id,
    role: a.role,
    prompt: a.systemPrompt ? `${a.systemPrompt}\n\nTask: ${goal}` : `Task: ${goal}`,
  }));

  const edges: Array<{ from: string; to: string }> = [];
  const coordinator = nodes.find((n) => n.role === "coordinator");
  if (coordinator) {
    for (const n of nodes) {
      if (n.id !== coordinator.id) edges.push({ from: n.id, to: coordinator.id });
    }
  }

  return { goal, nodes, edges };
}

