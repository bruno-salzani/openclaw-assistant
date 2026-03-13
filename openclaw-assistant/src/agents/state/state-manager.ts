import type { RedisCache } from "../../memory/providers/redis-cache.js";
import type { PostgresStore } from "../../memory/providers/postgres-store.js";
import type { AgentState, AgentStateStatus } from "./types.js";

function key(taskId: string, agentName: string) {
  return `agent_state:${taskId}:${agentName}`;
}

export class AgentStateManager {
  constructor(
    private readonly deps: {
      redis: RedisCache;
      postgres: PostgresStore;
      ttlSeconds?: number;
    }
  ) {}

  async save(state: AgentState) {
    const now = Date.now();
    const agentName = String((state as any).agentName ?? (state as any).agentId ?? "");
    if (!agentName) throw new Error("missing agentId/agentName");
    const record: AgentState & { agentName: string } = {
      ...state,
      taskId: String(state.taskId),
      agentName,
      agentId: String((state as any).agentId ?? agentName),
      step: String(state.step),
      progress: Number.isFinite((state as any).progress) ? Number((state as any).progress) : 0,
      status: state.status,
      memoryRefs: Array.isArray(state.memoryRefs) ? state.memoryRefs.map(String) : [],
      createdAt: state.createdAt ?? now,
      updatedAt: now,
    };
    await this.deps.redis.set(
      key(record.taskId, record.agentName),
      JSON.stringify(record),
      this.deps.ttlSeconds
    );
    await this.deps.postgres.upsertAgentState(record);
    await this.deps.postgres.insertAgentStateCheckpoint(record);
    return record;
  }

  async load(taskId: string, agentName: string) {
    const cached = await this.deps.redis.get(key(taskId, agentName));
    if (cached) {
      try {
        return JSON.parse(cached) as AgentState;
      } catch {}
    }
    const row = await this.deps.postgres.getAgentState(taskId, agentName);
    if (row) {
      const rowAgent = String((row as any).agentName ?? (row as any).agentId ?? "");
      await this.deps.redis.set(
        key(row.taskId, rowAgent),
        JSON.stringify(row),
        this.deps.ttlSeconds
      );
    }
    return row;
  }

  async findByStatus(status: AgentStateStatus, limit = 100) {
    return this.deps.postgres.findAgentStatesByStatus(status, limit);
  }

  async listCheckpoints(taskId: string, agentName: string, limit = 100) {
    return this.deps.postgres.listAgentStateCheckpoints(taskId, agentName, limit);
  }

  async rollbackToCheckpoint(checkpointId: string, status: AgentStateStatus = "pending") {
    const checkpoint = await this.deps.postgres.getAgentStateCheckpoint(checkpointId);
    if (!checkpoint) return null;
    const now = Date.now();
    return this.save({
      ...checkpoint,
      status,
      updatedAt: now,
    });
  }
}
