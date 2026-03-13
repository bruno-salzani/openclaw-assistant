import type { MetricsRegistry } from "../observability/metrics.js";
import { RedisCache } from "./providers/redis-cache.js";
import { PostgresStore } from "./providers/postgres-store.js";
import { VectorStore } from "./providers/vector-store.js";
import { getEmbedding } from "./providers/embedding.js";
import type { MemoryEntry } from "./memory-types.js";
import { getVectorDB } from "../vector/vector-router.js";
import { AgentStateManager } from "../agents/state/state-manager.js";
import type { AgentState } from "../agents/state/types.js";
import type { KnowledgeGraphStore } from "../knowledge-graph/graph.js";
import { tryParseJson } from "../infra/json.js";

export class MemorySystem {
  private readonly shortTerm: RedisCache;

  private readonly longTerm: PostgresStore;

  private semantic: VectorStore;

  private readonly agentState: AgentStateManager;

  private readonly metrics: MetricsRegistry;

  constructor(metrics: MetricsRegistry) {
    this.metrics = metrics;
    this.shortTerm = new RedisCache(process.env.OPENCLAW_X_REDIS_URL);
    this.longTerm = new PostgresStore(process.env.OPENCLAW_X_POSTGRES_URL);
    this.semantic = new VectorStore({
      insert: async () => undefined,
      search: async () => [],
    });
    this.agentState = new AgentStateManager({
      redis: this.shortTerm,
      postgres: this.longTerm,
      ttlSeconds: Number(process.env.IA_ASSISTANT_AGENT_STATE_TTL_SECONDS ?? 3600),
    });
  }

  async init() {
    const db = await getVectorDB();
    this.semantic = new VectorStore(db);
    await Promise.all([this.shortTerm.connect(), this.longTerm.init(), this.semantic.init()]);
  }

  getKnowledgeGraphStore(): KnowledgeGraphStore {
    return this.longTerm as any;
  }

  saveAgentState(state: AgentState) {
    return this.agentState.save(state);
  }

  loadAgentState(taskId: string, agentName: string) {
    return this.agentState.load(taskId, agentName);
  }

  listAgentStateCheckpoints(taskId: string, agentName: string, limit = 100) {
    return this.agentState.listCheckpoints(taskId, agentName, limit);
  }

  findRunningAgentStates(limit = 100) {
    return this.agentState.findByStatus("running", limit);
  }

  async recoverTasks(params: { queue: { enqueue: (t: any) => Promise<void> }; limit?: number }) {
    const limit = Number.isFinite(params.limit) ? Number(params.limit) : 200;
    const tasks = await this.longTerm.findTasksByStatuses(["running", "retrying"], limit);
    for (const t of tasks) {
      await params.queue.enqueue({ ...t, status: "pending", updatedAt: Date.now() });
      await this.updateTask(t.taskId, "pending");
      await this.saveAgentState({
        taskId: t.taskId,
        agentName: t.agentType ?? t.type,
        step: "recovered",
        progress: 0,
        status: "pending",
        context: { recoveredAt: Date.now() },
        memoryRefs: [],
      });
    }
    return { recovered: tasks.length };
  }

  async logExecutionStart(workflowId: string, context: any): Promise<string> {
    return this.longTerm.startExecution(workflowId, context);
  }

  async logExecutionEnd(executionId: string, status: string, durationMs: number) {
    await this.longTerm.completeExecution(executionId, status, durationMs);
  }

  async logTask(task: any) {
    await this.longTerm.addTask(task);
  }

  async updateTask(taskId: string, status: string, result?: any, error?: any) {
    await this.longTerm.updateTaskStatus(taskId, status, result, error);
  }

  async incrementTaskRetry(taskId: string) {
    await this.longTerm.incrementTaskRetry(taskId);
  }

  async logEvent(event: any) {
    await this.longTerm.addEvent(event);
  }

  async add(
    type:
      | "short-term"
      | "sensory"
      | "working"
      | "long-term"
      | "event"
      | "episodic"
      | "ontology"
      | "goal"
      | "procedural"
      | "meta",
    content: string,
    metadata?: Record<string, unknown>
  ) {
    if (type === "short-term" || type === "sensory" || type === "working") {
      const sessionId = metadata?.sessionId as string;
      if (sessionId) {
        const key =
          type === "sensory" ? `sensory:${sessionId}` : type === "working" ? `working:${sessionId}` : `session:${sessionId}`;
        const history = (await this.shortTerm.get(key)) || "[]";
        const messages = tryParseJson<any[]>(history) ?? [];
        messages.push({ content, metadata, timestamp: Date.now() });
        const max = type === "sensory" ? 50 : type === "working" ? 200 : 20;
        while (messages.length > max) messages.shift();
        const ttl = type === "sensory" ? 300 : Math.min(3600, 300 + messages.length * 30);
        await this.shortTerm.set(key, JSON.stringify(messages), ttl);
      }
    } else if (type === "long-term" || type === "episodic") {
      // Episodic memory stores specific events/experiences
      await this.longTerm.add(content, { ...metadata, type: "episodic" });
      // Also index semantically
      const vector = await getEmbedding(content);
      await this.semantic.add(content, vector, { ...metadata, type: "episodic" });
    } else if (type === "ontology") {
      // Ontology stores facts/relationships about the user's world
      await this.longTerm.add(content, { ...metadata, type: "ontology" });
      const vector = await getEmbedding(content);
      await this.semantic.add(content, vector, { ...metadata, type: "ontology" });
    } else if (type === "goal") {
      // Goals are stored in long-term memory for retrieval
      await this.longTerm.add(content, { ...metadata, type: "goal" });
      const vector = await getEmbedding(content);
      await this.semantic.add(content, vector, { ...metadata, type: "goal" });
    } else if (type === "event") {
      // Events are just immutable logs in long-term for now
      await this.longTerm.add(`[EVENT] ${content}`, { type: "event", ...metadata });
    } else if (type === "procedural") {
      // Procedural memory: How to do things (workflows, code snippets)
      await this.longTerm.add(content, { ...metadata, type: "procedural" });
      const vector = await getEmbedding(content);
      await this.semantic.add(content, vector, { ...metadata, type: "procedural" });
    } else if (type === "meta") {
      // Meta memory: Knowledge about self (performance, reliability)
      await this.longTerm.add(content, { ...metadata, type: "meta" });
      // Meta memory might not need semantic search often, but useful for "how well did I do X?"
      const vector = await getEmbedding(content);
      await this.semantic.add(content, vector, { ...metadata, type: "meta" });
    }
  }

  async addBatch(
    entries: Array<{
      type:
        | "short-term"
        | "sensory"
        | "working"
        | "long-term"
        | "event"
        | "episodic"
        | "ontology"
        | "goal"
        | "procedural"
        | "meta";
      content: string;
      metadata?: Record<string, unknown>;
    }>
  ) {
    for (const e of entries) {
      await this.add(e.type as any, e.content, e.metadata);
    }
  }

  async search(
    query: string,
    options?: { limit?: number; type?: "semantic" | "exact"; workspaceId?: string; userId?: string }
  ): Promise<MemoryEntry[]> {
    if (options?.type === "exact") {
      return this.longTerm.search(query, options.limit);
    }
    const vector = await getEmbedding(query);
    const filter: Record<string, unknown> = {};
    if (options?.workspaceId) filter.workspaceId = options.workspaceId;
    if (options?.userId) filter.userId = options.userId;
    return this.semantic.search(
      vector,
      options?.limit,
      Object.keys(filter).length > 0 ? filter : undefined
    );
  }

  async getSessionContext(sessionId: string): Promise<any[]> {
    const data = await this.shortTerm.get(`session:${sessionId}`);
    return data ? tryParseJson<any[]>(data) ?? [] : [];
  }
}
