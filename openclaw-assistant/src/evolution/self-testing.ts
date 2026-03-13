import type { AgentDeps } from "../agents/agent-deps.js";

export class SelfTestingSystem {
  constructor(private readonly deps: AgentDeps) {}

  async runToolSmokeTest(toolName: string) {
    try {
      const workspaceId = "ws:system";
      const perms = this.deps.permissions
        ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
        : [];
      await this.deps.tools.execute(
        toolName,
        {},
        { userRole: "service", permissions: perms, source: "self_test", workspaceId }
      );
      await this.deps.memory.add("event", `Self-test passed for ${toolName}`, {
        type: "self-test",
        status: "passed",
      });
      try {
        this.deps.bus?.emit("selftest.passed", { target: toolName, kind: "tool" });
      } catch {}
      return true;
    } catch (err: any) {
      await this.deps.memory.add("event", `Self-test failed for ${toolName}`, {
        type: "self-test",
        status: "failed",
        error: String(err?.message || err),
      });
      try {
        this.deps.bus?.emit("selftest.failed", {
          target: toolName,
          kind: "tool",
          error: String(err?.message || err),
        });
      } catch {}
      return false;
    }
  }

  async runProjectTestSuite() {
    const workspaceId = "ws:system";
    const perms = this.deps.permissions
      ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
      : [];
    return this.runToolSmokeTestWithArgs(
      "terminal.run",
      { command: "npm test" },
      perms,
      workspaceId
    );
  }

  private async runToolSmokeTestWithArgs(
    toolName: string,
    input: Record<string, any>,
    perms: string[],
    workspaceId: string
  ) {
    try {
      await this.deps.tools.execute(toolName, input, {
        userRole: "service",
        permissions: perms,
        sandbox: true,
        timeout: 10 * 60_000,
        source: "self_test",
        workspaceId,
      });
      await this.deps.memory.add("event", `Self-test passed for ${toolName}`, {
        type: "self-test",
        status: "passed",
      });
      try {
        this.deps.bus?.emit("selftest.passed", { target: toolName, kind: "tool" });
      } catch {}
      return true;
    } catch (err: any) {
      await this.deps.memory.add("event", `Self-test failed for ${toolName}`, {
        type: "self-test",
        status: "failed",
        error: String(err?.message || err),
      });
      try {
        this.deps.bus?.emit("selftest.failed", {
          target: toolName,
          kind: "tool",
          error: String(err?.message || err),
        });
      } catch {}
      return false;
    }
  }
}
