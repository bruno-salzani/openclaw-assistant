import type { AgentState, AgentStateStatus } from "./state-types.js";
import type { AgentStateManager } from "./state-manager.js";

export type AgentStateStore = {
  save: (state: AgentState) => Promise<AgentState>;
  load: (taskId: string, agentIdOrName: string) => Promise<AgentState | null>;
  findByStatus: (status: AgentStateStatus, limit?: number) => Promise<AgentState[]>;
  listCheckpoints: (taskId: string, agentIdOrName: string, limit?: number) => Promise<AgentState[]>;
  rollbackToCheckpoint: (
    checkpointId: string,
    status?: AgentStateStatus
  ) => Promise<AgentState | null>;
};

export class DefaultAgentStateStore implements AgentStateStore {
  constructor(private readonly manager: AgentStateManager) {}

  save(state: AgentState) {
    return this.manager.save(state as any);
  }

  load(taskId: string, agentIdOrName: string) {
    return this.manager.load(taskId, agentIdOrName);
  }

  findByStatus(status: AgentStateStatus, limit?: number) {
    return this.manager.findByStatus(status, limit);
  }

  listCheckpoints(taskId: string, agentIdOrName: string, limit?: number) {
    return this.manager.listCheckpoints(taskId, agentIdOrName, limit);
  }

  rollbackToCheckpoint(checkpointId: string, status?: AgentStateStatus) {
    return this.manager.rollbackToCheckpoint(checkpointId, status);
  }
}

