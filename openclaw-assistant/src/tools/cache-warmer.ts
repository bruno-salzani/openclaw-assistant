import type { AgentDeps } from "../agents/agent-deps.js";

export class CacheWarmer {
  constructor(private readonly deps: AgentDeps) {}

  async warm() {
    const tools = ["finance.get_market_data"];
    for (const name of tools) {
      try {
        const workspaceId = "ws:system";
        const perms = this.deps.permissions
          ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
          : [];
        await this.deps.tools.execute(
          name,
          {},
          {
            userRole: "service",
            permissions: perms,
            cacheTtlMs: 60000,
            rate: { perMin: 10 },
            workspaceId,
          }
        );
        await this.deps.memory.add("event", "cache_warm", { tool: name });
      } catch {}
    }
  }
}
