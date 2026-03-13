import type { AutonomousAgent } from "../types.js";

export function buildEvolverReviewAgent(): AutonomousAgent {
  return {
    id: "evolver_review_agent",
    description: "Observa resultados do evolver e registra decisões/risco",
    triggers: [{ kind: "event", topic: "evolver.result" }],
    run: async (deps, ctx) => {
      const p = ctx.payload as any;
      const workspaceId = ctx.workspaceId ?? "ws:system";
      const summary = p && typeof p === "object" ? (p.summary ?? {}) : {};
      await deps.memory.add("event", "evolver_result_observed", {
        workspaceId,
        summary,
        tasks: Array.isArray(p?.tasks) ? p.tasks.slice(0, 10) : [],
      });

      const accept = Number(summary?.accept ?? 0);
      const committed = Number(summary?.committed ?? 0);
      if (accept > 0 && committed === 0) {
        deps.bus?.emit("autonomous.review.suggestion", {
          kind: "evolver",
          message: "Há patches aceitos pelo evaluator, mas nenhum commit foi feito (commit/apply podem estar desativados).",
          workspaceId,
        });
      }
    },
  };
}

