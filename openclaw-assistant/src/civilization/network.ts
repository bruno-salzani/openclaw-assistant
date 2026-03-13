import type { Bid, CivilizationId, TaskOffer } from "./types.js";

type CivilizationSpec = {
  id: CivilizationId;
  serviceTags: string[];
  defaultAgentType?: string;
};

export class AgentCivilizationsNetwork {
  private readonly civs = new Map<CivilizationId, CivilizationSpec>();

  register(spec: CivilizationSpec) {
    this.civs.set(spec.id, spec);
  }

  list(): CivilizationSpec[] {
    return [...this.civs.values()];
  }

  proposeBids(offer: TaskOffer): Bid[] {
    const hint = this.offerHint(offer);
    const bids: Bid[] = [];
    for (const civ of this.civs.values()) {
      const match = civ.serviceTags.some((t) => hint.includes(t));
      const confidence = match ? 0.85 : 0.25;
      const priceCredits = this.basePrice(offer) * (match ? 1 : 2);
      bids.push({
        civilization: civ.id,
        agentType: civ.defaultAgentType,
        priceCredits,
        confidence,
        reason: match ? `match:${civ.id}` : `fallback:${civ.id}`,
      });
    }
    return bids.sort((a, b) => b.confidence - a.confidence || a.priceCredits - b.priceCredits);
  }

  private basePrice(offer: TaskOffer): number {
    if (offer.priority === "high") return 50;
    if (offer.priority === "medium") return 20;
    return 10;
  }

  private offerHint(offer: TaskOffer): string {
    const payload = JSON.stringify(offer.payload).toLowerCase();
    return `${offer.type}:${payload}`;
  }
}

export function buildDefaultCivilizations(): AgentCivilizationsNetwork {
  const n = new AgentCivilizationsNetwork();
  n.register({
    id: "engineering",
    serviceTags: ["code", "build", "deploy", "bug", "refactor"],
    defaultAgentType: "automation_agent",
  });
  n.register({
    id: "scientific",
    serviceTags: ["paper", "experiment", "hypothesis", "dataset"],
    defaultAgentType: "analysis_agent",
  });
  n.register({
    id: "economic",
    serviceTags: ["portfolio", "investment", "market", "finance"],
    defaultAgentType: "finance_agent",
  });
  n.register({
    id: "creative",
    serviceTags: ["design", "copy", "story", "content"],
    defaultAgentType: "document_parser",
  });
  n.register({
    id: "governance",
    serviceTags: ["policy", "risk", "compliance", "ethics"],
    defaultAgentType: "analysis_agent",
  });
  return n;
}
