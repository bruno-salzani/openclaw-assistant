import type { AgentState, AgentStateStatus } from "./state-types.js";
import type { AgentStateStore } from "./agent-state-store.js";

function resolveAgentName(state: AgentState) {
  return String(state.agentName ?? state.agentId ?? "");
}

export class CheckpointManager {
  constructor(private readonly store: AgentStateStore) {}

  async saveCheckpoint(state: AgentState) {
    const agentName = resolveAgentName(state);
    if (!agentName) throw new Error("missing agentId/agentName");
    if (!state.taskId) throw new Error("missing taskId");
    if (!state.step) throw new Error("missing step");
    const now = Date.now();
    return this.store.save({
      ...state,
      agentName,
      agentId: state.agentId ?? agentName,
      progress: Number.isFinite(state.progress) ? Number(state.progress) : 0,
      status: state.status,
      updatedAt: now,
      createdAt: state.createdAt ?? now,
    });
  }

  pause(params: { taskId: string; agentId: string; step: string; context?: any; memorySnapshot?: any }) {
    return this.saveCheckpoint({
      taskId: params.taskId,
      agentId: params.agentId,
      step: params.step,
      status: "paused",
      context: params.context,
      memorySnapshot: params.memorySnapshot,
    });
  }

  complete(params: { taskId: string; agentId: string; step: string; context?: any; memorySnapshot?: any }) {
    return this.saveCheckpoint({
      taskId: params.taskId,
      agentId: params.agentId,
      step: params.step,
      status: "completed",
      progress: 1,
      context: params.context,
      memorySnapshot: params.memorySnapshot,
    });
  }

  fail(params: { taskId: string; agentId: string; step: string; error?: any; context?: any; memorySnapshot?: any }) {
    return this.saveCheckpoint({
      taskId: params.taskId,
      agentId: params.agentId,
      step: params.step,
      status: "failed",
      progress: 1,
      context: { ...(params.context ?? {}), error: params.error },
      memorySnapshot: params.memorySnapshot,
    });
  }

  resumeFromCheckpoint(taskId: string, agentId: string) {
    return this.store.load(taskId, agentId);
  }

  listHistory(taskId: string, agentId: string, limit = 100) {
    return this.store.listCheckpoints(taskId, agentId, limit);
  }

  rollback(checkpointId: string, status: AgentStateStatus = "paused") {
    return this.store.rollbackToCheckpoint(checkpointId, status);
  }
}

