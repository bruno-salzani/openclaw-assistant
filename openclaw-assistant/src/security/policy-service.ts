import type { MetricsRegistry } from "../observability/metrics.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { EventBus } from "../infra/event-bus.js";
import { InstructionFirewall } from "./instruction-firewall.js";
import { RiskEngine } from "./risk-engine.js";

export type PolicyRisk = "low" | "medium" | "high";
export type ToolLevel = "safe" | "restricted" | "dangerous";

export type PolicyDecision = {
  allowed: boolean;
  requireConfirmation: boolean;
  risk: PolicyRisk;
  level: ToolLevel;
  reason?: string;
};

export type PolicyContext = {
  userRole: "user" | "admin" | "service";
  approved?: boolean;
  traceId?: string;
  source?: string;
};

export class PolicyService {
  private readonly firewall = new InstructionFirewall();

  private callCounts = new Map<string, number>();

  private lastDay?: string;

  private readonly riskEngine = new RiskEngine();

  constructor(
    private readonly deps: { metrics: MetricsRegistry; memory: MemorySystem; bus?: EventBus }
  ) {
    this.deps.metrics.createCounter("policy_denies_total", "Total number of policy denies");
    this.deps.metrics.createCounter(
      "policy_requires_confirmation_total",
      "Total number of policy decisions requiring confirmation"
    );
  }

  evaluateTool(toolName: string, input: Record<string, any>, ctx: PolicyContext): PolicyDecision {
    const userRole = ctx.userRole;
    const today = new Date().toDateString();
    if (this.lastDay && this.lastDay !== today) {
      this.callCounts.clear();
    }
    this.lastDay = today;

    const key = `${toolName}:${today}`;
    const count = (this.callCounts.get(key) || 0) + 1;
    this.callCounts.set(key, count);
    const rateLimited = count > 50;

    const restrictedTools = new Set(["terminal.rm", "docker.rm", "filesystem.rm"]);
    const adminOnlyTools = new Set(["terminal.run", "docker.run_container", "postgres.query"]);
    const safePrefixes = ["memory.read", "graph.read", "search.read", "calendar.list"];
    const dangerousPrefixes = [
      "terminal.",
      "docker.",
      "filesystem.write",
      "email.send",
      "postgres.",
      "system.reconfigure",
    ];

    let level: ToolLevel = "restricted";
    if (safePrefixes.some((p) => toolName.startsWith(p))) level = "safe";
    if (dangerousPrefixes.some((p) => toolName.startsWith(p))) level = "dangerous";

    const isHigh = dangerousPrefixes.some((p) => toolName.startsWith(p));

    const inputStr = JSON.stringify(input);
    const issues = this.firewall.analyze(inputStr);

    const riskEngineEnabled = process.env.IA_ASSISTANT_RISK_ENGINE_ENABLE === "1";
    if (riskEngineEnabled) {
      const assessment = this.riskEngine.assessTool(toolName, input, ctx);
      const blockThreshold = Number(process.env.IA_ASSISTANT_RISK_ENGINE_BLOCK_THRESHOLD ?? 0.95);
      const confirmThreshold = Number(process.env.IA_ASSISTANT_RISK_ENGINE_CONFIRM_THRESHOLD ?? 0.8);
      try {
        this.deps.bus?.emit("risk.assessment", {
          tool: toolName,
          traceId: ctx.traceId,
          userRole: ctx.userRole,
          assessment,
        });
      } catch {}
      if (assessment.riskScore >= blockThreshold) {
        if (ctx.userRole === "admin" && ctx.approved) {
          return this.emitAndReturn(toolName, input, ctx, {
            allowed: true,
            requireConfirmation: false,
            risk: "high",
            level,
            reason: `risk_engine_override:${assessment.reasons.join(",")}`,
          });
        }
        return this.emitAndReturn(toolName, input, ctx, {
          allowed: false,
          requireConfirmation: !ctx.approved,
          risk: "high",
          level,
          reason: `risk_engine_blocked:${assessment.reasons.join(",")}`,
        });
      }
      if (assessment.riskScore >= confirmThreshold && !ctx.approved) {
        return this.emitAndReturn(toolName, input, ctx, {
          allowed: false,
          requireConfirmation: true,
          risk: assessment.risk,
          level,
          reason: `risk_engine_needs_approval:${assessment.reasons.join(",")}`,
        });
      }
    }

    if (
      toolName === "terminal.run" &&
      ctx.userRole === "service" &&
      ctx.source === "self_test" &&
      process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER === "1" &&
      typeof (input as any)?.command === "string" &&
      String((input as any).command).trim() === "npm test"
    ) {
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: true,
        requireConfirmation: false,
        risk: "medium",
        level: "restricted",
        reason: "service_test_runner_allowlist",
      });
    }

    if (restrictedTools.has(toolName)) {
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: false,
        risk: "high",
        level: "restricted",
        reason: "restricted_tool",
      });
    }

    if (adminOnlyTools.has(toolName) && userRole !== "admin") {
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: false,
        risk: "high",
        level: "dangerous",
        reason: "admin_only",
      });
    }

    if (level === "dangerous" && !ctx.approved) {
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: true,
        risk: "high",
        level: "dangerous",
        reason: "dangerous_tool_needs_approval",
      });
    }

    if (issues.length > 0) {
      if (ctx.approved && userRole === "admin") {
        return this.emitAndReturn(toolName, input, ctx, {
          allowed: true,
          requireConfirmation: false,
          risk: "high",
          level,
          reason: `approved_firewall:${issues.join(",")}`,
        });
      }
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: true,
        risk: "high",
        level,
        reason: `firewall:${issues.join(",")}`,
      });
    }

    if (rateLimited) {
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: true,
        risk: "high",
        level,
        reason: "rate_limit",
      });
    }

    if (isHigh && userRole !== "admin") {
      if (ctx.approved) {
        return this.emitAndReturn(toolName, input, ctx, {
          allowed: true,
          requireConfirmation: false,
          risk: "high",
          level: "dangerous",
          reason: "approved_high_risk",
        });
      }
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: true,
        risk: "high",
        level: "dangerous",
        reason: "high_risk_tool",
      });
    }

    if (isHigh) {
      if (ctx.approved) {
        return this.emitAndReturn(toolName, input, ctx, {
          allowed: true,
          requireConfirmation: false,
          risk: "medium",
          level: "dangerous",
          reason: "approved_sensitive",
        });
      }
      return this.emitAndReturn(toolName, input, ctx, {
        allowed: false,
        requireConfirmation: true,
        risk: "medium",
        level: "dangerous",
        reason: "sensitive_operation",
      });
    }

    return this.emitAndReturn(toolName, input, ctx, {
      allowed: true,
      requireConfirmation: false,
      risk: "low",
      level,
    });
  }

  private emitAndReturn(
    tool: string,
    input: Record<string, any>,
    ctx: PolicyContext,
    d: PolicyDecision
  ) {
    if (!d.allowed) {
      this.deps.metrics.counter("policy_denies_total").inc();
      try {
        this.deps.bus?.emit("policy.deny", {
          tool,
          reason: d.reason,
          input,
          userRole: ctx.userRole,
          traceId: ctx.traceId,
        });
      } catch {}
    }
    if (d.requireConfirmation) {
      this.deps.metrics.counter("policy_requires_confirmation_total").inc();
    }
    try {
      this.deps.bus?.emit("policy.decision", {
        tool,
        decision: d,
        userRole: ctx.userRole,
        traceId: ctx.traceId,
        source: ctx.source,
      });
    } catch {}
    this.deps.memory
      .add("event", "policy_decision", {
        tool,
        decision: d,
        userRole: ctx.userRole,
        traceId: ctx.traceId,
        source: ctx.source,
      })
      .catch(() => undefined);
    return d;
  }
}
