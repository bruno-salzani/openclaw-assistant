import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class ResearchAgent implements Agent {
  role: Agent["role"] = "research";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("research", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.research", { sessionId: ctx.sessionId });
    try {
      this.deps.metrics.counter("research_runs_total").inc();
      const taskId =
        typeof (ctx.metadata as any)?.taskId === "string"
          ? String((ctx.metadata as any).taskId)
          : undefined;
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "research",
            step: "start",
            progress: 0,
            status: "running",
            context: { query: ctx.text },
            memoryRefs: [],
          });
        } catch {}
      }
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      const traceId =
        typeof (ctx.metadata as any)?.traceId === "string"
          ? String((ctx.metadata as any).traceId)
          : undefined;
      // Mock research: search memory + web
      const memoryResults = await this.deps.memory.search(ctx.text, {
        limit: 3,
        workspaceId,
        userId: ctx.userId,
      });
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "research",
            step: "memory_search_done",
            progress: 0.35,
            status: "running",
            context: { hits: memoryResults.length },
            memoryRefs: memoryResults.map((m) => m.id).filter(Boolean),
          });
        } catch {}
      }

      // Try to use browser tool if available
      let webResults = "";
      try {
        if (taskId) {
          try {
            await this.deps.memory.saveAgentState({
              taskId,
              agentName: "research",
              step: "web_search",
              progress: 0.6,
              status: "running",
              context: { tool: "browser.*" },
              memoryRefs: [],
            });
          } catch {}
        }
        const browser = this.deps.tools.listTools().find((t) => t.includes("browser"));
        if (browser) {
          const userRole = ctx.userRole ?? "user";
          const perms = this.deps.permissions
            ? this.deps.permissions.getPermissions("research_agent", workspaceId)
            : [];
          webResults = await this.deps.tools.execute(
            browser,
            { query: ctx.text },
            { userRole, permissions: perms, workspaceId, traceId, source: "agent.research" }
          );
        }
      } catch (e) {
        webResults = "Web search failed or not available";
      }
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "research",
            step: "completed",
            progress: 1,
            status: "completed",
            context: { web: Boolean(webResults) },
            memoryRefs: [],
          });
        } catch {}
      }

      return {
        text: `Research findings based on memory and web:\nMemory: ${JSON.stringify(memoryResults)}\nWeb: ${webResults}`,
        meta: { source: "hybrid" },
      };
    } finally {
      span.end();
    }
  }
}
