export type AgentBlueprint = {
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  memory: "vector" | "episodic";
};

export type AgentRegistryEntry = {
  name: string;
  version: string;
  description?: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  createdAt: number;
  updatedAt: number;
};

export type CapabilityGap = {
  task: string;
  requiredCapabilities: string[];
  candidates: AgentRegistryEntry[];
};

