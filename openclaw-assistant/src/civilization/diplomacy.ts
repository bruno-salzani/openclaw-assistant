import type { AgentDeps } from "../agents/agent-deps.js";
import type { Bid, CivilizationId, TaskOffer } from "./types.js";

export class DiplomaticIntelligenceLayer {
  private readonly allocations = new Map<CivilizationId, number>();

  constructor(private readonly deps: AgentDeps) {
    this.deps.metrics.createCounter(
      "diplomacy_conflicts_total",
      "Total diplomacy conflict resolutions"
    );
  }

  mediate(offer: TaskOffer, bids: Bid[]): Bid[] {
    if (bids.length <= 1) return bids;
    this.deps.metrics.counter("diplomacy_conflicts_total").inc();

    return bids
      .map((b) => {
        const used = this.allocations.get(b.civilization) ?? 0;
        const fairnessPenalty = Math.min(0.25, used * 0.00001);
        const adjustedConfidence = Math.max(0, b.confidence - fairnessPenalty);
        return {
          ...b,
          confidence: adjustedConfidence,
          reason: `${b.reason}|fairness=${fairnessPenalty.toFixed(3)}`,
        };
      })
      .sort((a, b) => b.confidence - a.confidence || a.priceCredits - b.priceCredits);
  }

  recordAllocation(civ: CivilizationId) {
    this.allocations.set(civ, (this.allocations.get(civ) ?? 0) + 1);
  }
}
