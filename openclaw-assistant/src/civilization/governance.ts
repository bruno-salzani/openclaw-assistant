import type { AgentDeps } from "../agents/agent-deps.js";
import type { GovernanceDecision, TaskOffer } from "./types.js";

export type ConstitutionalRule = {
  id: string;
  severity: "advisory" | "hard";
  matches: (offer: TaskOffer) => boolean;
  decision: (offer: TaskOffer) => GovernanceDecision;
};

export class AIConstitution {
  private readonly rules: ConstitutionalRule[] = [];

  register(rule: ConstitutionalRule) {
    this.rules.push(rule);
  }

  list() {
    return [...this.rules];
  }
}

export class PolicyEngine {
  constructor(
    private readonly deps: AgentDeps,
    private readonly constitution: AIConstitution
  ) {
    this.deps.metrics.createCounter("governance_denies_total", "Total governance denials");
  }

  evaluate(offer: TaskOffer): GovernanceDecision {
    for (const rule of this.constitution.list()) {
      if (rule.matches(offer)) {
        const d = rule.decision(offer);
        if (!d.allow) this.deps.metrics.counter("governance_denies_total").inc();
        return d;
      }
    }
    return { allow: true };
  }
}

export function buildDefaultConstitution(): AIConstitution {
  const c = new AIConstitution();

  c.register({
    id: "no-malware",
    severity: "hard",
    matches: (offer) => {
      const s = JSON.stringify(offer.payload).toLowerCase();
      return s.includes("malware") || s.includes("ransomware") || s.includes("keylogger");
    },
    decision: () => ({ allow: false, requireHuman: true, reason: "unsafe_request" }),
  });

  c.register({
    id: "sensitive-tools",
    severity: "hard",
    matches: (offer) => {
      const s = JSON.stringify(offer.payload).toLowerCase();
      return s.includes("terminal") || s.includes("docker") || s.includes("filesystem");
    },
    decision: () => ({ allow: false, requireHuman: true, reason: "sensitive_operation" }),
  });

  c.register({
    id: "energy-reactor-oversight",
    severity: "hard",
    matches: (offer) => {
      const s = JSON.stringify(offer.payload).toLowerCase();
      return s.includes("reactor") || s.includes("nuclear") || s.includes("fusion");
    },
    decision: () => ({
      allow: false,
      requireHuman: true,
      reason: "energy_project_requires_oversight",
    }),
  });

  c.register({
    id: "space-systems-oversight",
    severity: "hard",
    matches: (offer) => {
      const s = JSON.stringify(offer.payload).toLowerCase();
      return s.includes("satellite") || s.includes("orbit") || s.includes("space");
    },
    decision: () => ({
      allow: false,
      requireHuman: true,
      reason: "space_system_requires_oversight",
    }),
  });

  return c;
}
