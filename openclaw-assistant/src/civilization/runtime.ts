import type { AgentDeps } from "../agents/agent-deps.js";
import type { Task } from "../tasks/task-types.js";
import { CognitiveEconomy } from "./economy.js";
import { DiplomaticIntelligenceLayer } from "./diplomacy.js";
import { buildDefaultConstitution, PolicyEngine } from "./governance.js";
import { buildDefaultCivilizations } from "./network.js";
import type { Bid, GovernanceDecision, TaskOffer } from "./types.js";

export class CivilizationRuntime {
  private readonly economy: CognitiveEconomy;

  private readonly diplomacy: DiplomaticIntelligenceLayer;

  private readonly policy: PolicyEngine;

  private readonly network = buildDefaultCivilizations();

  constructor(private readonly deps: AgentDeps) {
    this.economy = new CognitiveEconomy(deps);
    this.diplomacy = new DiplomaticIntelligenceLayer(deps);
    this.policy = new PolicyEngine(deps, buildDefaultConstitution());
    this.deps.metrics.createCounter(
      "civilization_tasks_assigned_total",
      "Total tasks assigned by civilization runtime"
    );
  }

  assign(task: Task): { decision: GovernanceDecision; bid?: Bid } {
    const offer: TaskOffer = {
      taskId: task.taskId,
      type: task.type,
      priority: task.priority,
      payload: task.payload,
    };

    const decision = this.policy.evaluate(offer);
    if (!decision.allow) return { decision };

    const bids = this.network.proposeBids(offer);
    const mediated = this.diplomacy.mediate(offer, bids);
    const winner = mediated[0];
    if (winner) this.diplomacy.recordAllocation(winner.civilization);
    this.deps.metrics.counter("civilization_tasks_assigned_total").inc();
    return { decision, bid: winner };
  }
}
