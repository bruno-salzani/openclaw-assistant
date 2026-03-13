import type { LongTermMemory, MemoryEntry } from "../memory-types.js";
import type { AgentState, AgentStateStatus } from "../../agents/state/types.js";
import type { Entity, Relationship } from "../../knowledge-graph/graph.js";
import pkg from "pg";
const { Pool } = pkg;

function normalizeAgentStateStatus(value: unknown): AgentStateStatus {
  const v = String(value ?? "");
  if (v === "pending" || v === "running" || v === "paused" || v === "completed" || v === "failed")
    return v;
  return "pending";
}

export class PostgresStore implements LongTermMemory {
  private pool: pkg.Pool | null = null;

  private readonly localStore: MemoryEntry[] = [];

  private readonly localAgentStates = new Map<string, AgentState>();

  private readonly localAgentStateCheckpoints = new Map<string, AgentState[]>();

  private readonly localGraphNodes = new Map<string, Entity>();

  private readonly localGraphEdges: Relationship[] = [];

  private readonly localTasks = new Map<string, any>();

  constructor(url?: string) {
    if (url) {
      this.pool = new Pool({ connectionString: url });
    }
  }

  async init() {
    if (this.pool) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content TEXT NOT NULL,
          metadata JSONB,
          created_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_states (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id VARCHAR(255) NOT NULL,
          agent_name VARCHAR(255) NOT NULL,
          step VARCHAR(255) NOT NULL,
          progress DOUBLE PRECISION NOT NULL,
          status VARCHAR(50) NOT NULL,
          context JSONB,
          memory_snapshot JSONB,
          memory_refs JSONB,
          context_hash VARCHAR(255),
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE (task_id, agent_name)
        );
        CREATE TABLE IF NOT EXISTS agent_state_checkpoints (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id VARCHAR(255) NOT NULL,
          agent_name VARCHAR(255) NOT NULL,
          step VARCHAR(255) NOT NULL,
          progress DOUBLE PRECISION NOT NULL,
          status VARCHAR(50) NOT NULL,
          context JSONB,
          memory_snapshot JSONB,
          memory_refs JSONB,
          context_hash VARCHAR(255),
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_nodes (
          node_id VARCHAR(255) PRIMARY KEY,
          workspace_id VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          name TEXT NOT NULL,
          properties JSONB,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE (workspace_id, type, name)
        );
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace_type ON graph_nodes (workspace_id, type);
        CREATE TABLE IF NOT EXISTS graph_edges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id VARCHAR(255) NOT NULL,
          source_id VARCHAR(255) NOT NULL,
          target_id VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          properties JSONB,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE (workspace_id, source_id, target_id, type)
        );
        CREATE INDEX IF NOT EXISTS idx_graph_edges_workspace_source ON graph_edges (workspace_id, source_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_workspace_target ON graph_edges (workspace_id, target_id);
        CREATE TABLE IF NOT EXISTS events (
          event_id VARCHAR(255) PRIMARY KEY,
          type VARCHAR(255) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
          source VARCHAR(255) NOT NULL,
          payload JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workflows (
          workflow_id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          definition JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS tasks (
          task_id VARCHAR(255) PRIMARY KEY,
          workflow_id VARCHAR(255),
          step_id VARCHAR(255),
          agent_type VARCHAR(255),
          type VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          priority VARCHAR(20) NOT NULL,
          payload JSONB,
          result JSONB,
          error JSONB,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          retries INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS executions (
          execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_id VARCHAR(255) NOT NULL,
          status VARCHAR(50) NOT NULL,
          context JSONB,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          duration_ms INTEGER
        );
      `);
      await this.pool.query(
        "ALTER TABLE IF EXISTS agent_states ADD COLUMN IF NOT EXISTS memory_snapshot JSONB"
      );
      await this.pool.query(
        "ALTER TABLE IF EXISTS agent_state_checkpoints ADD COLUMN IF NOT EXISTS memory_snapshot JSONB"
      );
    }
  }

  async addEvent(event: any) {
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO events (event_id, type, timestamp, source, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING",
        [event.event_id, event.type, event.timestamp, event.source, event.payload]
      );
    }
  }

  async addTask(task: any) {
    this.localTasks.set(String(task.taskId), task);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO tasks (task_id, workflow_id, step_id, agent_type, type, status, priority, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (task_id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, result = EXCLUDED.result, error = EXCLUDED.error, retries = tasks.retries`,
        [
          task.taskId,
          task.workflowId,
          task.stepId,
          task.agentType,
          task.type,
          task.status,
          task.priority,
          task.payload,
          task.createdAt,
          task.updatedAt,
        ]
      );
    }
  }

  async updateTaskStatus(taskId: string, status: string, result?: any, error?: any) {
    if (this.pool) {
      await this.pool.query(
        "UPDATE tasks SET status = $1, result = $2, error = $3, updated_at = $4 WHERE task_id = $5",
        [status, result, error, Date.now(), taskId]
      );
    }
  }

  async incrementTaskRetry(taskId: string) {
    if (this.pool) {
      await this.pool.query(
        "UPDATE tasks SET retries = retries + 1, updated_at = $1 WHERE task_id = $2",
        [Date.now(), taskId]
      );
    }
  }

  async startExecution(workflowId: string, context: any): Promise<string> {
    const id = crypto.randomUUID();
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO executions (execution_id, workflow_id, status, context) VALUES ($1, $2, 'running', $3)",
        [id, workflowId, context]
      );
    }
    return id;
  }

  async completeExecution(executionId: string, status: string, durationMs: number) {
    if (this.pool) {
      await this.pool.query(
        "UPDATE executions SET status = $1, completed_at = NOW(), duration_ms = $2 WHERE execution_id = $3",
        [status, durationMs, executionId]
      );
    }
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      metadata,
      createdAt: Date.now(),
    };

    if (this.pool) {
      const res = await this.pool.query(
        "INSERT INTO memories (content, metadata, created_at) VALUES ($1, $2, $3) RETURNING id",
        [content, metadata, entry.createdAt]
      );
      return res.rows[0].id;
    } else {
      this.localStore.push(entry);
      return entry.id;
    }
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    if (this.pool) {
      // Full text search stub
      const res = await this.pool.query(
        "SELECT * FROM memories WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT $2",
        [`%${query}%`, limit]
      );
      return res.rows.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: row.metadata,
        createdAt: Number(row.created_at),
      }));
    } else {
      return this.localStore
        .filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
    }
  }

  async upsertGraphNode(node: Entity, workspaceId?: string) {
    const ws = String(workspaceId ?? "global");
    const id = String(node.id);
    const record: Entity = {
      id,
      type: String((node as any).type) as any,
      name: String(node.name ?? ""),
      properties: node.properties && typeof node.properties === "object" ? node.properties : {},
    };
    this.localGraphNodes.set(`${ws}:${record.id}`, record);
    if (!this.pool) return;
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO graph_nodes (node_id, workspace_id, type, name, properties, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (node_id) DO UPDATE SET
         type = EXCLUDED.type,
         name = EXCLUDED.name,
         properties = EXCLUDED.properties,
         updated_at = EXCLUDED.updated_at`,
      [record.id, ws, record.type, record.name, record.properties ?? {}, now, now]
    );
  }

  async upsertGraphEdge(edge: Relationship, workspaceId?: string) {
    const ws = String(workspaceId ?? "global");
    const record: Relationship = {
      source: String(edge.source),
      target: String(edge.target),
      type: String((edge as any).type) as any,
      properties:
        edge.properties && typeof edge.properties === "object" ? edge.properties : undefined,
    };
    this.localGraphEdges.push(record);
    if (!this.pool) return;
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO graph_edges (workspace_id, source_id, target_id, type, properties, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, source_id, target_id, type) DO UPDATE SET
         properties = EXCLUDED.properties,
         updated_at = EXCLUDED.updated_at`,
      [ws, record.source, record.target, record.type, record.properties ?? {}, now, now]
    );
  }

  async searchGraphNodes(query: string, limit = 10, workspaceId?: string): Promise<Entity[]> {
    const ws = String(workspaceId ?? "global");
    const lim = Math.max(1, Math.min(500, Number(limit)));
    const q = String(query ?? "").trim();
    if (!q) return [];
    if (!this.pool) {
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
      const scored: Array<{ score: number; e: Entity }> = [];
      for (const [k, e] of this.localGraphNodes.entries()) {
        if (!k.startsWith(`${ws}:`)) continue;
        const name = String(e.name ?? "").toLowerCase();
        const props = JSON.stringify(e.properties ?? {}).toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (name.includes(t)) score += 5;
          else if (props.includes(t)) score += 1;
        }
        if (score > 0) scored.push({ score, e });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, lim).map((x) => x.e);
    }
    const like = `%${q}%`;
    const res = await this.pool.query(
      `SELECT node_id, type, name, properties, created_at, updated_at
       FROM graph_nodes
       WHERE workspace_id = $1 AND (name ILIKE $2 OR properties::text ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT $3`,
      [ws, like, lim]
    );
    return res.rows.map((row) => ({
      id: String(row.node_id),
      type: String(row.type) as any,
      name: String(row.name),
      properties: row.properties ?? {},
    }));
  }

  async listGraphEdgesFrom(
    sourceId: string,
    limit = 20,
    workspaceId?: string,
    type?: Relationship["type"]
  ): Promise<Relationship[]> {
    const ws = String(workspaceId ?? "global");
    const lim = Math.max(1, Math.min(500, Number(limit)));
    const src = String(sourceId);
    const ty = type ? String(type) : null;
    if (!this.pool) {
      const out = this.localGraphEdges
        .filter((e) => e.source === src && (!ty || String(e.type) === ty))
        .slice(-lim)
        .reverse();
      return out;
    }
    const res = await this.pool.query(
      `SELECT source_id, target_id, type, properties
       FROM graph_edges
       WHERE workspace_id = $1 AND source_id = $2 AND ($3::text IS NULL OR type = $3)
       ORDER BY updated_at DESC
       LIMIT $4`,
      [ws, src, ty, lim]
    );
    return res.rows.map((row) => ({
      source: String(row.source_id),
      target: String(row.target_id),
      type: String(row.type) as any,
      properties: row.properties ?? undefined,
    }));
  }

  async getGraphNodeByTypeName(
    type: Entity["type"],
    name: string,
    workspaceId?: string
  ): Promise<Entity | null> {
    const ws = String(workspaceId ?? "global");
    const ty = String(type);
    const nm = String(name ?? "").trim();
    if (!nm) return null;
    if (!this.pool) {
      for (const [k, e] of this.localGraphNodes.entries()) {
        if (!k.startsWith(`${ws}:`)) continue;
        if (String(e.type) === ty && String(e.name).toLowerCase() === nm.toLowerCase()) return e;
      }
      return null;
    }
    const res = await this.pool.query(
      `SELECT node_id, type, name, properties
       FROM graph_nodes
       WHERE workspace_id = $1 AND type = $2 AND LOWER(name) = LOWER($3)
       LIMIT 1`,
      [ws, ty, nm]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.node_id),
      type: String(row.type) as any,
      name: String(row.name),
      properties: row.properties ?? {},
    };
  }

  async getGraphNodesByIds(ids: string[], workspaceId?: string): Promise<Entity[]> {
    const ws = String(workspaceId ?? "global");
    const wanted = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    if (wanted.length === 0) return [];
    if (!this.pool) {
      const out: Entity[] = [];
      for (const id of wanted) {
        const e = this.localGraphNodes.get(`${ws}:${id}`);
        if (e) out.push(e);
      }
      return out;
    }
    const res = await this.pool.query(
      `SELECT node_id, type, name, properties
       FROM graph_nodes
       WHERE workspace_id = $1 AND node_id = ANY($2)`,
      [ws, wanted]
    );
    const byId = new Map<string, Entity>();
    for (const row of res.rows) {
      byId.set(String(row.node_id), {
        id: String(row.node_id),
        type: String(row.type) as any,
        name: String(row.name),
        properties: row.properties ?? {},
      });
    }
    return wanted.map((id) => byId.get(id)).filter((e): e is Entity => Boolean(e));
  }

  async upsertAgentState(state: AgentState) {
    const key = `${state.taskId}:${state.agentName}`;
    this.localAgentStates.set(key, state);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO agent_states (task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (task_id, agent_name) DO UPDATE SET
         step = EXCLUDED.step,
         progress = EXCLUDED.progress,
         status = EXCLUDED.status,
         context = EXCLUDED.context,
         memory_snapshot = EXCLUDED.memory_snapshot,
         memory_refs = EXCLUDED.memory_refs,
         context_hash = EXCLUDED.context_hash,
         updated_at = EXCLUDED.updated_at`,
      [
        state.taskId,
        state.agentName,
        state.step,
        state.progress,
        state.status,
        state.context ?? null,
        (state as any).memorySnapshot ?? null,
        state.memoryRefs ?? [],
        state.contextHash ?? null,
        state.createdAt ?? Date.now(),
        state.updatedAt ?? Date.now(),
      ]
    );
  }

  async insertAgentStateCheckpoint(state: AgentState) {
    const key = `${state.taskId}:${state.agentName}`;
    const list = this.localAgentStateCheckpoints.get(key) ?? [];
    list.push({ ...state, id: state.id ?? crypto.randomUUID() });
    this.localAgentStateCheckpoints.set(key, list);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO agent_state_checkpoints (task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        state.taskId,
        state.agentName,
        state.step,
        state.progress,
        state.status,
        state.context ?? null,
        (state as any).memorySnapshot ?? null,
        state.memoryRefs ?? [],
        state.contextHash ?? null,
        state.createdAt ?? Date.now(),
        state.updatedAt ?? Date.now(),
      ]
    );
  }

  async listAgentStateCheckpoints(
    taskId: string,
    agentName: string,
    limit = 100
  ): Promise<AgentState[]> {
    const lim = Math.max(1, Math.min(1000, Number(limit)));
    const key = `${taskId}:${agentName}`;
    if (!this.pool) {
      return (this.localAgentStateCheckpoints.get(key) ?? [])
        .slice()
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
        .slice(0, lim);
    }
    const res = await this.pool.query(
      "SELECT id, task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at FROM agent_state_checkpoints WHERE task_id = $1 AND agent_name = $2 ORDER BY created_at DESC LIMIT $3",
      [taskId, agentName, lim]
    );
    return res.rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      agentName: String(row.agent_name),
      agentId: String(row.agent_name),
      step: String(row.step),
      progress: Number(row.progress ?? 0),
      status: normalizeAgentStateStatus(row.status),
      context: row.context ?? undefined,
      memorySnapshot: row.memory_snapshot ?? undefined,
      memoryRefs: Array.isArray(row.memory_refs) ? row.memory_refs.map(String) : [],
      contextHash: row.context_hash ?? undefined,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    }));
  }

  async getAgentStateCheckpoint(checkpointId: string): Promise<AgentState | null> {
    if (!this.pool) {
      for (const list of this.localAgentStateCheckpoints.values()) {
        const found = list.find((s) => String((s as any).id ?? "") === checkpointId);
        if (found) return found;
      }
      return null;
    }
    const res = await this.pool.query(
      "SELECT id, task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at FROM agent_state_checkpoints WHERE id = $1 LIMIT 1",
      [checkpointId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      agentName: String(row.agent_name),
      agentId: String(row.agent_name),
      step: String(row.step),
      progress: Number(row.progress ?? 0),
      status: normalizeAgentStateStatus(row.status),
      context: row.context ?? undefined,
      memorySnapshot: row.memory_snapshot ?? undefined,
      memoryRefs: Array.isArray(row.memory_refs) ? row.memory_refs.map(String) : [],
      contextHash: row.context_hash ?? undefined,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    } as AgentState;
  }

  async getAgentState(taskId: string, agentName: string): Promise<AgentState | null> {
    const k = `${taskId}:${agentName}`;
    const local = this.localAgentStates.get(k);
    if (local) return local;
    if (!this.pool) return null;
    const res = await this.pool.query(
      "SELECT id, task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at FROM agent_states WHERE task_id = $1 AND agent_name = $2 LIMIT 1",
      [taskId, agentName]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      agentName: String(row.agent_name),
      agentId: String(row.agent_name),
      step: String(row.step),
      progress: Number(row.progress ?? 0),
      status: normalizeAgentStateStatus(row.status),
      context: row.context ?? undefined,
      memorySnapshot: row.memory_snapshot ?? undefined,
      memoryRefs: Array.isArray(row.memory_refs) ? row.memory_refs.map(String) : [],
      contextHash: row.context_hash ?? undefined,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    } as AgentState;
  }

  async findAgentStatesByStatus(status: string, limit = 100): Promise<AgentState[]> {
    const lim = Math.max(1, Math.min(1000, Number(limit)));
    if (!this.pool) {
      return Array.from(this.localAgentStates.values())
        .filter((s) => s.status === status)
        .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
        .slice(0, lim);
    }
    const res = await this.pool.query(
      "SELECT id, task_id, agent_name, step, progress, status, context, memory_snapshot, memory_refs, context_hash, created_at, updated_at FROM agent_states WHERE status = $1 ORDER BY updated_at DESC LIMIT $2",
      [status, lim]
    );
    return res.rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      agentName: String(row.agent_name),
      agentId: String(row.agent_name),
      step: String(row.step),
      progress: Number(row.progress ?? 0),
      status: normalizeAgentStateStatus(row.status),
      context: row.context ?? undefined,
      memorySnapshot: row.memory_snapshot ?? undefined,
      memoryRefs: Array.isArray(row.memory_refs) ? row.memory_refs.map(String) : [],
      contextHash: row.context_hash ?? undefined,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    }));
  }

  async findTasksByStatuses(statuses: string[], limit = 100) {
    const lim = Math.max(1, Math.min(1000, Number(limit)));
    const wanted = Array.isArray(statuses) ? statuses.map(String) : [];
    if (!this.pool) {
      return Array.from(this.localTasks.values())
        .filter((t: any) => wanted.includes(String(t.status ?? "")))
        .sort((a: any, b: any) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
        .slice(0, lim);
    }
    const res = await this.pool.query(
      "SELECT task_id, workflow_id, step_id, agent_type, type, status, priority, payload, created_at, updated_at, retries FROM tasks WHERE status = ANY($1) ORDER BY updated_at DESC LIMIT $2",
      [wanted, lim]
    );
    return res.rows.map((r) => ({
      taskId: String(r.task_id),
      workflowId: r.workflow_id ?? undefined,
      stepId: r.step_id ?? undefined,
      agentType: r.agent_type ?? undefined,
      type: String(r.type),
      status: String(r.status),
      priority: String(r.priority),
      payload: r.payload ?? {},
      createdAt: Number(r.created_at ?? 0),
      updatedAt: Number(r.updated_at ?? 0),
      retries: Number(r.retries ?? 0),
    }));
  }
}
