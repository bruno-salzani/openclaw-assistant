import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class ReviewerAgent implements Agent {
  role: Agent["role"] = "reviewer";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("reviewer", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.reviewer", { sessionId: ctx.sessionId });
    try {
      const taskId =
        typeof (ctx.metadata as any)?.taskId === "string"
          ? String((ctx.metadata as any).taskId)
          : undefined;
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "reviewer",
            step: "start",
            progress: 0,
            status: "running",
            context: {},
            memoryRefs: [],
          });
        } catch {}
      }
      const issues = this.deps.firewall.analyze(ctx.text);
      this.deps.metrics.counter("review_runs_total").inc();
      if (issues.length > 0) {
        if (taskId) {
          try {
            await this.deps.memory.saveAgentState({
              taskId,
              agentName: "reviewer",
              step: "blocked",
              progress: 1,
              status: "failed",
              context: { issues },
              memoryRefs: [],
            });
          } catch {}
        }
        return {
          text: JSON.stringify({ status: "blocked", issues }, null, 2),
          meta: { blocked: true, issues },
        };
      }
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "reviewer",
            step: "completed",
            progress: 1,
            status: "completed",
            context: {},
            memoryRefs: [],
          });
        } catch {}
      }
      return { text: JSON.stringify({ status: "ok" }, null, 2), meta: { blocked: false } };
    } finally {
      span.end();
    }
  }
}
