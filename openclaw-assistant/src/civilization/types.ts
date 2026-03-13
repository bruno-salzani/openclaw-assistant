export type CivilizationId = "engineering" | "scientific" | "economic" | "creative" | "governance";

export type AgentRank =
  | "micro"
  | "worker"
  | "specialist"
  | "architect"
  | "meta"
  | "civilization_architect";

export type AgentAccount = {
  agentId: string;
  civilization: CivilizationId;
  rank: AgentRank;
  reputation: number;
  trust: number;
  credits: number;
  capacity: number;
  capabilities: string[];
};

export type TaskOffer = {
  taskId: string;
  type: "research" | "execute" | "analyze";
  priority: "low" | "medium" | "high";
  payload: Record<string, unknown>;
};

export type Bid = {
  civilization: CivilizationId;
  agentType?: string;
  priceCredits: number;
  confidence: number;
  reason: string;
};

export type GovernanceDecision =
  | { allow: true }
  | { allow: false; requireHuman: boolean; reason: string };
