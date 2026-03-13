import type { AgentDeps } from "../agent-deps.js";

export type RiskLevel = "low" | "medium" | "high";

export class GovernanceLayer {
  private callCounts = new Map<string, number>();

  private lastDay?: string;

  constructor(private readonly deps: AgentDeps) {
    this.deps.metrics.createCounter(
      "governance_blocks_total",
      "Total number of actions blocked by governance"
    );
  }

  assess(
    toolName: string,
    input: Record<string, any>,
    userRole?: string
  ): { risk: RiskLevel; requireConfirmation: boolean; reason?: string } {
    const highRiskPrefixes = ["terminal.", "docker.", "filesystem.write", "email.send"];
    const isHigh = highRiskPrefixes.some((p) => toolName.startsWith(p));

    const today = new Date().toDateString();
    if (this.lastDay && this.lastDay !== today) {
      this.callCounts.clear();
    }
    this.lastDay = today;
    const key = `${toolName}:${today}`;
    const count = (this.callCounts.get(key) || 0) + 1;
    this.callCounts.set(key, count);
    const rateLimited = count > 50;

    if (rateLimited) {
      this.deps.metrics.counter("governance_blocks_total").inc();
      return { risk: "high", requireConfirmation: true, reason: "rate_limit" };
    }
    if (isHigh && userRole !== "admin") {
      return { risk: "high", requireConfirmation: true, reason: "high_risk_tool" };
    }
    if (isHigh) return { risk: "medium", requireConfirmation: true, reason: "sensitive_operation" };
    return { risk: "low", requireConfirmation: false };
  }
}
