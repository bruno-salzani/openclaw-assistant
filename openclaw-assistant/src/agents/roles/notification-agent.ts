import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class NotificationAgent implements Agent {
  role: Agent["role"] = "notification";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.notification", { sessionId: ctx.sessionId });
    try {
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      const to = String((ctx.metadata as any)?.to ?? "");
      const subject = String((ctx.metadata as any)?.subject ?? "");
      const body = String((ctx.metadata as any)?.body ?? "");
      const channel = String((ctx.metadata as any)?.channel ?? "email");
      const userRole = ctx.userRole ?? "user";
      const perms = this.deps.permissions
        ? this.deps.permissions.getPermissions("notification_agent", workspaceId)
        : [];
      if (channel === "slack") {
        const out = await this.deps.tools.execute(
          "slack.send",
          { channel: to, message: body },
          { userRole, permissions: perms, workspaceId }
        );
        return { text: JSON.stringify(out) };
      }
      const out = await this.deps.tools.execute(
        "email.send",
        { to, subject, body },
        { userRole, permissions: perms, workspaceId }
      );
      return { text: JSON.stringify(out) };
    } finally {
      span.end();
    }
  }
}
