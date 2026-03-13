import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class GraphPlannerAgent implements Agent {
  role: Agent["role"] = "planner";

  constructor(private readonly deps: AgentDeps) {}

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const query = ctx.text;
    const q = String(query ?? "");
    const steps: any[] = [];
    steps.push({ id: "r1", type: "research", dependsOn: [], payload: { query: q } });
    if (q.toLowerCase().includes("invoice") || q.toLowerCase().includes("finance")) {
      steps.push({
        id: "e1",
        type: "execute",
        dependsOn: ["r1"],
        payload: { toolName: "postgres.query", args: "SELECT * FROM invoices LIMIT 5" },
        priority: "high",
      });
      steps.push({ id: "a1", type: "analyze", dependsOn: ["r1", "e1"], payload: {} });
    } else if (q.toLowerCase().includes("schedule") || q.toLowerCase().includes("calendar")) {
      steps.push({
        id: "e1",
        type: "execute",
        dependsOn: ["r1"],
        payload: { toolName: "calendar.list", args: "next week" },
        priority: "high",
      });
      steps.push({ id: "a1", type: "analyze", dependsOn: ["r1", "e1"], payload: {} });
    } else {
      steps.push({ id: "a1", type: "analyze", dependsOn: ["r1"], payload: {} });
    }
    return { text: JSON.stringify({ steps }), meta: { agent: "graph_planner" } };
  }
}
