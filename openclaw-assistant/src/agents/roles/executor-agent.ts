import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class ExecutorAgent implements Agent {
  role: Agent["role"] = "executor";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("executor", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.executor", { sessionId: ctx.sessionId });
    try {
      this.deps.metrics.counter("execution_runs_total").inc();
      const taskId =
        typeof (ctx.metadata as any)?.taskId === "string"
          ? String((ctx.metadata as any).taskId)
          : undefined;
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "executor",
            step: "start",
            progress: 0,
            status: "running",
            context: { text: ctx.text },
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

      if (ctx.text.startsWith("tool:")) {
        const parts = ctx.text.split(" ");
        const toolName = parts[1];
        const args = parts.slice(2).join(" ");

        let input: any = { args };
        if (toolName === "terminal.run") input = { command: args };
        if (toolName === "browser.search") input = { query: args };
        const userRole = ctx.userRole ?? "user";
        if (taskId) {
          try {
            await this.deps.memory.saveAgentState({
              taskId,
              agentName: "executor",
              step: "tool_execute",
              progress: 0.6,
              status: "running",
              context: { toolName },
              memoryRefs: [],
            });
          } catch {}
        }

        // Get permissions if available
        const perms = this.deps.permissions
          ? this.deps.permissions.getPermissions("executor_agent", workspaceId)
          : [];

        const output = await this.deps.tools.execute(toolName, input, {
          sandbox: true,
          userRole,
          permissions: perms,
          workspaceId,
          traceId,
          source: "agent.executor",
        });
        if (taskId) {
          try {
            await this.deps.memory.saveAgentState({
              taskId,
              agentName: "executor",
              step: "completed",
              progress: 1,
              status: "completed",
              context: { toolName, ok: true },
              memoryRefs: [],
            });
          } catch {}
        }
        return { text: `Executed ${toolName}: ${JSON.stringify(output)}` };
      }

      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "executor",
            step: "completed",
            progress: 1,
            status: "completed",
            context: { ok: false, reason: "no_instruction" },
            memoryRefs: [],
          });
        } catch {}
      }
      return { text: "No executable instruction found." };
    } finally {
      span.end();
    }
  }
}
