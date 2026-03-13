import type { AgentDeps } from "../agent-deps.js";
import { GovernanceLayer } from "./governance.js";

export class PolicyGateway {
  private readonly governance: GovernanceLayer;

  constructor(private readonly deps: AgentDeps) {
    this.governance = new GovernanceLayer(deps);
  }

  evaluate(tool: string, input: Record<string, any>, userRole?: string) {
    if (this.deps.policy) {
      const assessment = this.deps.policy.evaluateTool(tool, input, {
        userRole: userRole === "admin" || userRole === "service" ? userRole : "user",
        source: "policy_gateway",
      });
      if (assessment.requireConfirmation && assessment.risk !== "low") {
        try {
          this.deps.bus?.emit("policy.deny", { tool, reason: assessment.reason, input });
        } catch {}
      }
      return assessment;
    }
    const assessment = this.governance.assess(tool, input, userRole);
    if (assessment.requireConfirmation && assessment.risk !== "low") {
      try {
        this.deps.bus?.emit("policy.deny", { tool, reason: assessment.reason, input });
      } catch {}
    }
    return assessment;
  }
}
