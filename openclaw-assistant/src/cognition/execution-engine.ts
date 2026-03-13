import type { AgentContext, AgentResult, AgentRole } from "../agents/types.js";
import { AgentGraph } from "../agents/graph/agent-graph.js";
import type { CognitiveExecution, CognitivePlan, SpawnRun } from "./types.js";

function normalizeCtx(ctx: AgentContext, text: string) {
  return { ...ctx, text };
}

export class ExecutionEngine {
  async runSpawn(params: {
    ctx: AgentContext;
    plan: CognitivePlan;
    runAgent: (role: AgentRole, ctx: AgentContext) => Promise<AgentResult>;
  }): Promise<CognitiveExecution> {
    const spawn = params.plan.spawn ?? [];
    if (!spawn.length) return { spawnRuns: [], contextText: "" };

    const g = new AgentGraph({
      nodes: spawn.map((s) => ({
        id: s.id,
        run: async () => params.runAgent(s.role, normalizeCtx(params.ctx, s.prompt)),
      })),
      edges: [],
    });

    const out = await g.execute(params.ctx);
    const spawnRuns: SpawnRun[] = [];
    for (const s of spawn) {
      const r = out.resultsByNodeId[s.id] as any;
      spawnRuns.push({
        id: s.id,
        role: s.role,
        ok: Boolean(r && typeof r === "object" ? (r as any).ok ?? true : true),
        text: String((r as any)?.text ?? r ?? ""),
        meta: (r as any)?.meta ? ((r as any).meta as any) : undefined,
      });
    }

    const contextText = spawnRuns
      .map((r) => {
        const head = `[Swarm:${r.id}:${r.role}]`;
        const body = String(r.text ?? "").trim();
        return body ? `${head}\n${body}` : head;
      })
      .join("\n\n");

    return { spawnRuns, contextText };
  }
}
