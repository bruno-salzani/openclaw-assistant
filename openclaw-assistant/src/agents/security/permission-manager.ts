import type { AgentDeps } from "../agent-deps.js";

export type Permission = string;

export class PermissionManager {
  private permissions: Map<string, Set<Permission>> = new Map();

  private workspacePermissions: Map<string, Map<string, Set<Permission>>> = new Map();

  constructor(private readonly deps: AgentDeps) {
    // Default Permissions
    this.grant("autonomy_controller", [
      "workflow.*",
      "browser.*",
      "filesystem.read",
      "calendar.*",
      "apps.*",
      "email.*",
      "finance.*",
      "screen.*",
      "keyboard.*",
      "mouse.*",
      "game.*",
      "auto.*",
      "marketplace.*",
      "skill.*",
      "skill_learning.*",
      "tool_intelligence.*",
      "learning.*",
      "self_improvement.*",
      "optimization.*",
      "cluster.*",
    ]);
    this.grant("automation_agent", [
      "workflow.*",
      "browser.*",
      "filesystem.read",
      "calendar.*",
      "apps.*",
      "email.*",
      "finance.*",
      "screen.*",
      "keyboard.*",
      "mouse.*",
      "game.*",
      "auto.*",
      "marketplace.*",
      "skill.*",
      "skill_learning.*",
      "tool_intelligence.*",
      "learning.*",
      "self_improvement.*",
      "optimization.*",
      "cluster.*",
    ]);
    this.grant("research_agent", ["browser.*", "filesystem.read"]);
    this.grant("planner_agent", ["tool_intelligence.*"]);
    this.grant("executor_agent", ["apps.*", "calendar.*", "email.*", "iot.*", "screen.*", "keyboard.*", "mouse.*", "game.*"]);
    this.grant("analyst_agent", ["filesystem.read", "postgres.read"]);
    this.grant("finance_agent", ["finance.*"]);
    this.grant("reliability_agent", ["filesystem.read"]);
    this.grant("curator_agent", ["filesystem.read"]);
    this.grant("simulation_agent", ["filesystem.read"]);
    this.grant("experiment_agent", ["filesystem.read"]);
    this.grant("notification_agent", ["email.*", "apps.*"]);
    this.grant("document_agent", ["filesystem.read"]);
  }

  grant(agentId: string, perms: Permission[]) {
    if (!this.permissions.has(agentId)) {
      this.permissions.set(agentId, new Set());
    }
    const agentPerms = this.permissions.get(agentId)!;
    perms.forEach((p) => agentPerms.add(p));
  }

  grantForWorkspace(workspaceId: string, agentId: string, perms: Permission[]) {
    if (!this.workspacePermissions.has(workspaceId)) {
      this.workspacePermissions.set(workspaceId, new Map());
    }
    const byAgent = this.workspacePermissions.get(workspaceId)!;
    if (!byAgent.has(agentId)) byAgent.set(agentId, new Set());
    const s = byAgent.get(agentId)!;
    perms.forEach((p) => s.add(p));
  }

  getPermissions(agentId: string, workspaceId?: string): Permission[] {
    const base = Array.from(this.permissions.get(agentId) ?? []);
    if (!workspaceId) return base;
    const scoped = this.workspacePermissions.get(workspaceId)?.get(agentId);
    if (!scoped) return base;
    const merged = new Set<Permission>(base);
    for (const p of scoped) merged.add(p);
    return Array.from(merged);
  }

  async check(agentId: string, resource: string, action: string): Promise<boolean> {
    const perms = this.getPermissions(agentId);
    const required = `${resource}.${action}`;
    const wildcard = `${resource}.*`;

    return perms.includes("*") || perms.includes(wildcard) || perms.includes(required);
  }
}
