import type { AgentDeps } from "../agents/agent-deps.js";

export type OptimizationInsight = {
  type: "strategy_adjustment" | "parameter_tuning" | "new_skill_needed" | "workflow_optimization";
  reason: string;
  action: Record<string, unknown>;
  confidence: number;
};

export class SelfImprovementEngine {
  constructor(private readonly deps: AgentDeps) {}

  async analyzePerformance(timeWindowMs: number = 3600000): Promise<OptimizationInsight[]> {
    const insights: OptimizationInsight[] = [];
    const stats = await this.deps.queue.stats();
    const threshold = Number(process.env.OPENCLAW_X_SELF_IMPROVE_PENDING_THRESHOLD ?? 25);
    const failThreshold = Number(process.env.OPENCLAW_X_SELF_IMPROVE_FAILED_THRESHOLD ?? 5);

    if (stats.pending >= threshold) {
      insights.push({
        type: "strategy_adjustment",
        reason: `High pending backlog detected (pending=${stats.pending})`,
        action: {
          target: "worker_pool",
          adjustment: "scale_up",
          pending: stats.pending,
          timeWindowMs,
        },
        confidence: 0.9,
      });
    }

    if (stats.failed >= failThreshold) {
      insights.push({
        type: "parameter_tuning",
        reason: `Task failures observed (failed=${stats.failed})`,
        action: {
          target: "task_retry",
          adjustment: "increase_backoff",
          failed: stats.failed,
          timeWindowMs,
        },
        confidence: 0.8,
      });
    }

    return insights;
  }

  async applyOptimization(insight: OptimizationInsight) {
    await this.deps.memory.add("event", `Applying optimization: ${insight.type}`, { insight });

    if (insight.type === "strategy_adjustment") {
      // In a real system, this would update a config file or database
      // Here we log it as an architectural evolution event
      await this.deps.memory.add("ontology", JSON.stringify(insight.action), {
        type: "system_config_update",
      });
    }

    // "new_skill_needed" is handled by SkillGenerator
  }
}
