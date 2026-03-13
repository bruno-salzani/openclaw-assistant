export type AgentStateStatus = "pending" | "running" | "paused" | "completed" | "failed";

export type AgentState = {
  id?: string;
  taskId: string;
  agentName?: string;
  agentId?: string;
  step: string;
  progress?: number;
  status: AgentStateStatus;
  context?: any;
  memorySnapshot?: any;
  memoryRefs?: string[];
  contextHash?: string;
  createdAt?: number;
  updatedAt?: number;
};

