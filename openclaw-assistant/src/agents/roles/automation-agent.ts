import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class AutomationAgent implements Agent {
  role: Agent["role"] = "automation";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.automation", { sessionId: ctx.sessionId });
    try {
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      // Runs predefined workflows
      if (ctx.text.startsWith("workflow:")) {
        const workflowName = ctx.text.split(":")[1].trim();
        const userRole = ctx.userRole ?? "user";
        const perms = this.deps.permissions
          ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
          : [];
        const result = await this.deps.tools.execute(
          `workflow:${workflowName}`,
          (ctx.metadata || {}) as any,
          { userRole, permissions: perms, workspaceId }
        );
        return { text: `Workflow ${workflowName} completed`, meta: { result } };
      }
      return { text: "No workflow triggered" };
    } finally {
      span.end();
    }
  }
}
