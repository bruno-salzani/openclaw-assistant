import { EventBus } from "../infra/event-bus.js";
import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { WorkflowEngine } from "../workflows/engine.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { KnowledgeGraph } from "../knowledge-graph/graph.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { Tracer } from "../observability/tracing.js";
import { sanitizeInput } from "../security/input-sanitizer.js";
import { startGatewayHttpServer, type GatewayHttpServer } from "./http-server.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../events/event-types.js";
import type { TriggerEngine } from "../triggers/engine.js";
import { PairingManager } from "./pairing.js";
import type { PermissionManager } from "../agents/security/permission-manager.js";
import type { ToolRegistry } from "../tools/registry/tool-registry.js";
import type { AgentTracker } from "../observability/agent-tracker.js";
import type { LLMProvider } from "../llm/llm-provider.js";

import type { GatewayMessage, GatewayResponse } from "./types.js";
import { AgentContextBuilder } from "../agents/context-builder.js";
import { detectPromptInjection } from "../security/ai-safety/prompt-injection-detector.js";

// Re-export for compatibility
export type { GatewayMessage, GatewayResponse };

export type CoreGatewayDeps = {
  orchestrator: AgentOrchestrator;
  workflows: WorkflowEngine;
  memory: MemorySystem;
  skills: SkillMarketplace;
  tools: ToolExecutionEngine;
  toolRegistry?: ToolRegistry;
  aiObs?: AgentTracker;
  graph: KnowledgeGraph;
  tracer: Tracer;
  metrics: MetricsRegistry;
  queue: TaskQueue;
  triggers: TriggerEngine;
  llm?: LLMProvider;
  bus?: EventBus;
  permissions?: PermissionManager;
};

export class CoreGateway {
  private readonly orchestrator: AgentOrchestrator;

  private readonly workflows: WorkflowEngine;

  private readonly memory: MemorySystem;

  private readonly skills: SkillMarketplace;

  private readonly tools: ToolExecutionEngine;

  private readonly toolRegistry?: ToolRegistry;

  private readonly aiObs?: AgentTracker;

  private readonly graph: KnowledgeGraph;

  private readonly tracer: Tracer;

  private readonly metrics: MetricsRegistry;

  private readonly queue: TaskQueue;

  private readonly triggers: TriggerEngine;

  private readonly bus: EventBus;

  private readonly permissions?: PermissionManager;

  private readonly llm?: LLMProvider;

  private readonly sessions = new Map<
    string,
    { userId: string; channel: string; lastSeen: number }
  >();

  private readonly authRegistry = new Map<string, { role: string }>();

  private running = false;

  private httpServer: GatewayHttpServer | null = null;

  private sessionSweepTimer: any | null = null;

  private readonly pairing = new PairingManager({ cwd: process.cwd() });

  constructor(deps: CoreGatewayDeps) {
    this.orchestrator = deps.orchestrator;
    this.workflows = deps.workflows;
    this.memory = deps.memory;
    this.skills = deps.skills;
    this.tools = deps.tools;
    this.toolRegistry = deps.toolRegistry;
    this.aiObs = deps.aiObs;
    this.graph = deps.graph;
    this.tracer = deps.tracer;
    this.metrics = deps.metrics;
    this.queue = deps.queue;
    this.triggers = deps.triggers;
    this.llm = deps.llm;
    this.bus = deps.bus ?? new EventBus();
    this.permissions = deps.permissions;
    this.setupInternalHandlers();
  }

  private setupInternalHandlers() {
    this.bus.on("auth.login", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const token = (payload as { token?: unknown }).token;
      const userId = (payload as { userId?: unknown }).userId;
      if (typeof token !== "string" || typeof userId !== "string") return;
      if (token === process.env.OPENCLAW_X_ADMIN_TOKEN) {
        this.authRegistry.set(userId, { role: "admin" });
        this.bus.emit("auth.success", { userId });
      }
    });
  }

  async start() {
    this.running = true;
    this.metrics.counter("gateway_start_total").inc();
    if (!this.sessionSweepTimer) {
      const ttlMs = Number(process.env.OPENCLAW_X_SESSION_TTL_MS ?? 30 * 60 * 1000);
      const sweepEveryMs = Number(process.env.OPENCLAW_X_SESSION_SWEEP_MS ?? 60 * 1000);
      const tick = () => {
        const now = Date.now();
        for (const [k, v] of this.sessions) {
          if (now - v.lastSeen > ttlMs) this.sessions.delete(k);
        }
      };
      this.sessionSweepTimer = setInterval(tick, sweepEveryMs);
      if (typeof (this.sessionSweepTimer as any).unref === "function")
        (this.sessionSweepTimer as any).unref();
    }
    if (!this.httpServer) {
      const port = Number(process.env.OPENCLAW_X_PORT ?? 18789);
      this.httpServer = startGatewayHttpServer({
        gateway: this,
        port,
        metrics: this.metrics,
      });
    }
    console.log(`[CoreGateway] Started on port ${process.env.OPENCLAW_X_PORT ?? 18789}`);
  }

  async stop() {
    this.running = false;
    this.metrics.counter("gateway_stop_total").inc();
    if (this.httpServer) {
      await this.httpServer.close();
      this.httpServer = null;
    }
    if (this.sessionSweepTimer) {
      clearInterval(this.sessionSweepTimer);
      this.sessionSweepTimer = null;
    }
  }

  on(event: string, handler: (payload: unknown) => void) {
    this.bus.on(event, handler);
    return () => this.bus.off(event, handler as any);
  }

  async handleMessage(message: GatewayMessage): Promise<GatewayResponse> {
    if (!this.running) {
      await this.start();
    }
    const sanitizedText = sanitizeInput(message.text || "");
    this.sessions.set(message.sessionId, {
      userId: message.userId,
      channel: message.channel,
      lastSeen: Date.now(),
    });

    const span = this.tracer.startSpan("gateway.handleMessage", {
      sessionId: message.sessionId,
      channel: message.channel,
    });

    try {
      this.metrics.counter("gateway_messages_total").inc();
      this.bus.emit("message.inbound", message);

      const userRole = message.userRole ?? this.getUserRole(message.userId);
      const workspaceId = this.resolveWorkspaceId(message.userId, userRole, message.metadata);
      const traceId = String(message.metadata?.traceId ?? randomUUID());
      if (process.env.IA_ASSISTANT_AI_SAFETY_ENABLE === "1") {
        const inj = detectPromptInjection(sanitizedText);
        const humanConfirmed = Boolean((message.metadata as any)?.human_confirmed);
        if (inj.risk >= 0.85 && !humanConfirmed) {
          this.bus.emit("ai_safety.blocked", {
            kind: "prompt_injection",
            traceId,
            workspaceId,
            risk: inj.risk,
            reasons: inj.reasons,
            ts: Date.now(),
          });
          return {
            sessionId: message.sessionId,
            text: `🚫 Possível prompt injection detectado (risk=${inj.risk.toFixed(2)}). Confirme para continuar.`,
            meta: { blocked: true, reasons: inj.reasons, risk: inj.risk },
            ui: {
              type: "chat_response",
              text: `🚫 Possível prompt injection detectado (risk=${inj.risk.toFixed(2)}). Confirme para continuar.`,
            },
          };
        }
      }
      const {
        userRole: _ignoredUserRole,
        workspaceId: _ignoredWorkspaceId,
        ...metadataRest
      } = message.metadata ?? {};

      let builtContext: Awaited<ReturnType<AgentContextBuilder["buildContext"]>> | null = null;
      if (sanitizedText) {
        try {
          builtContext = await new AgentContextBuilder({
            memory: this.memory,
            graph: this.graph,
            queue: this.queue,
            llm: this.llm,
          }).buildContext({
            sessionId: message.sessionId,
            query: sanitizedText,
            userId: message.userId,
            workspaceId,
          });
        } catch {
          builtContext = null;
        }
      }
      if (sanitizedText) {
        this.memory.add("short-term", sanitizedText, {
          sessionId: message.sessionId,
          role: "user",
          userId: message.userId,
          channel: message.channel,
          workspaceId,
        });
      }
      const response = await this.orchestrator.run({
        sessionId: message.sessionId,
        userId: message.userId,
        userRole,
        channel: message.channel,
        text: sanitizedText,
        history: builtContext?.llmMessages ?? builtContext?.history,
        metadata: {
          ...metadataRest,
          traceId,
          modality: message.modality,
          workspaceId,
          contextText: builtContext?.contextText,
        },
      });
      if (response.text) {
        this.memory.add("short-term", String(response.text), {
          sessionId: message.sessionId,
          role: "assistant",
          userId: message.userId,
          channel: message.channel,
          workspaceId,
        });
      }

      const payload: GatewayResponse = {
        sessionId: message.sessionId,
        text: response.text,
        meta: response.meta,
        ui: response.meta?.ui as Record<string, unknown>,
      };

      this.bus.emit("message.outbound", payload);
      return payload;
    } finally {
      span.end();
    }
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  getUserRole(userId: string): "user" | "admin" {
    const role = this.authRegistry.get(userId)?.role;
    return role === "admin" ? "admin" : "user";
  }

  async getTaskStats() {
    return this.queue.stats();
  }

  async getTaskSnapshot(limit?: number) {
    return this.queue.snapshot(limit);
  }

  async getAutonomyStatus() {
    const queue = await this.queue.stats();
    const sessions = this.sessions.size;
    const dagDefault = process.env.OPENCLAW_X_USE_DAG_DEFAULT !== "0";
    const uptimeSeconds = Math.floor(process.uptime());
    const mem = process.memoryUsage();
    return {
      sessions,
      queue,
      dagDefault,
      uptimeSeconds,
      pid: process.pid,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    };
  }

  async skillLearningList() {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("skill_learning.list", {}, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.skill_learning",
    });
    return out;
  }

  async skillLearningApprove(id: string) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("skill_learning.approve", { id }, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.skill_learning",
    });
    return out;
  }

  async skillLearningReject(id: string) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("skill_learning.reject", { id }, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.skill_learning",
    });
    return out;
  }

  async skillLearningCreate(input: { id: string; description?: string; steps: any[] }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("skill_learning.create", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.skill_learning",
    });
    return out;
  }

  listToolMarketplace() {
    return {
      enabled: String(process.env.IA_ASSISTANT_TOOL_MARKETPLACE ?? "1") === "1",
      pluginsDir:
        process.env.IA_ASSISTANT_TOOL_PLUGIN_ROOT &&
        String(process.env.IA_ASSISTANT_TOOL_PLUGIN_ROOT).trim()
          ? String(process.env.IA_ASSISTANT_TOOL_PLUGIN_ROOT)
          : undefined,
      tools: this.toolRegistry?.list() ?? [],
      registeredCount: this.toolRegistry?.list().length ?? 0,
      engineCount: this.tools.listTools().length,
    };
  }

  async listToolIntelligence(params?: { limit?: number }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false, profiles: [] };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute(
      "tool_intelligence.stats",
      { limit: params?.limit ?? 200 },
      { userRole: "admin", permissions: perms, workspaceId: "ws:admin", source: "gateway.tool_intelligence" }
    );
    return { ...(out as any), enabled: true };
  }

  async recommendTools(input: { query?: string; candidates?: string[]; limit?: number }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false, best: null, ranked: [] };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("tool_intelligence.recommend", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.tool_intelligence",
    });
    return { ...(out as any), enabled: true };
  }

  async learningStats(limit?: number) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_LONGTERM_LEARNING_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false, events: 0, counters: {}, examples: 0 };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute(
      "learning.stats",
      { limit: typeof limit === "number" ? limit : 10_000 },
      { userRole: "admin", permissions: perms, workspaceId: "ws:admin", source: "gateway.learning" }
    );
    return { ...(out as any), enabled: true };
  }

  async exportLearningDataset(limit?: number) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_LONGTERM_LEARNING_ENABLE === "1";
    if (!enabled) return { ok: false, enabled: false, error: "disabled" };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute(
      "learning.dataset.export",
      { limit: typeof limit === "number" ? limit : 10_000 },
      { userRole: "admin", permissions: perms, workspaceId: "ws:admin", source: "gateway.learning" }
    );
    return { ...(out as any), enabled: true };
  }

  async recordUserCorrection(input: {
    sessionId?: string;
    userId?: string;
    traceId?: string;
    prompt: string;
    answer: string;
    correction: string;
  }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_LONGTERM_LEARNING_ENABLE === "1";
    if (!enabled) return { ok: false, enabled: false, error: "disabled" };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("learning.user_correction", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.learning",
    });
    return { ...(out as any), enabled: true };
  }

  async selfImprovementRunOnce(input: Record<string, unknown>) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("self_improvement.run_once", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.self_improvement",
    });
    return out as any;
  }

  async selfImprovementRunLoop(input: Record<string, unknown>) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("self_improvement.run_loop", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.self_improvement",
    });
    return out as any;
  }

  async episodicRecord(input: Record<string, unknown>) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("episodic.record", input as any, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.episodic",
    });
    return out as any;
  }

  async episodicSearch(params: { query: string; limit?: number; type?: "semantic" | "exact" }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute(
      "episodic.search",
      { query: params.query, limit: params.limit, type: params.type },
      {
        userRole: "admin",
        permissions: perms,
        workspaceId: "ws:admin",
        source: "gateway.episodic",
      }
    );
    return out as any;
  }

  async episodicLatest(limit?: number) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("episodic.latest", { limit }, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.episodic",
    });
    return out as any;
  }

  async optimizationStatus() {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_OPTIMIZER_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("optimization.status", {}, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.optimization",
    });
    return { ...(out as any), enabled: true };
  }

  async optimizationEvaluateModelRouter() {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_OPTIMIZER_ENABLE === "1";
    if (!enabled) return { ok: false, enabled: false, error: "disabled" };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("optimization.model_router.evaluate", {}, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.optimization",
    });
    return { ...(out as any), enabled: true };
  }

  async listClusterNodes(params?: { role?: string; includeStale?: boolean; staleMs?: number }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_CLUSTER_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false, nodeId: null, nodes: [] };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute("cluster.nodes.list", params ?? {}, {
      userRole: "admin",
      permissions: perms,
      workspaceId: "ws:admin",
      source: "gateway.cluster",
    });
    return { ...(out as any), enabled: true };
  }

  async reapClusterNodes(staleMs?: number) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const enabled = process.env.IA_ASSISTANT_CLUSTER_ENABLE === "1";
    if (!enabled) return { ok: true, enabled: false, removed: 0 };
    const perms = this.permissions.getPermissions("autonomy_controller");
    const out = await this.tools.execute(
      "cluster.nodes.reap",
      { staleMs: typeof staleMs === "number" ? staleMs : 60_000 },
      { userRole: "admin", permissions: perms, workspaceId: "ws:admin", source: "gateway.cluster" }
    );
    return { ...(out as any), enabled: true };
  }

  async reloadToolMarketplace() {
    if (!this.toolRegistry) return { ok: false, error: "toolRegistry not configured" };
    const { loadToolMarketplace } = await import("../tools/marketplace/index.js");
    const out = await loadToolMarketplace({
      tools: this.tools,
      registry: this.toolRegistry,
      metrics: this.metrics,
      forceReload: true,
      bustImportCache: true,
    });
    return { ok: true, ...out, total: this.toolRegistry.list().length };
  }

  listAiObservability(params?: {
    limit?: number;
    agent?: string;
    sessionId?: string;
    traceId?: string;
  }) {
    if (!this.aiObs) return { enabled: false, events: [] };
    return {
      enabled: true,
      events: this.aiObs.listRecent(params),
    };
  }

  getAiObservabilityStats() {
    if (!this.aiObs) return { enabled: false, stats: {} };
    return { enabled: true, stats: this.aiObs.statsByAgent() };
  }

  private resolveWorkspaceId(
    userId: string,
    role: "user" | "admin" | "service",
    metadata?: Record<string, unknown>
  ) {
    if (role === "admin") {
      const ws = typeof metadata?.workspaceId === "string" ? metadata.workspaceId : "";
      const cleaned = ws.replace(/[^\w:.-]/g, "").slice(0, 128);
      if (cleaned) return cleaned;
    }
    return `ws:${userId}`;
  }

  async ingestChannelMessage(input: {
    channel: string;
    sender: string;
    text: string;
    metadata?: Record<string, unknown>;
  }) {
    const channel = String(input.channel ?? "unknown");
    const sender = String(input.sender ?? "unknown");
    const access = this.checkChannelAccess({ channel, sender });
    if (!access.allowed)
      return {
        ok: false,
        ...(access.error ? { error: access.error } : {}),
        ...(access.pairing ? { pairing: access.pairing } : {}),
      };
    const text = sanitizeInput(String(input.text ?? ""));
    const sessionId = `chan:${channel}:${sender}`;
    const userId = `user:${channel}:${sender}`;
    const message: GatewayMessage = {
      sessionId,
      userId,
      channel,
      modality: "text",
      text,
      metadata: input.metadata ?? {},
    };
    const res = await this.handleMessage(message);
    return { ok: true, response: res };
  }

  checkChannelAccess(input: { channel: string; sender: string }) {
    const policy = process.env.OPENCLAW_X_DM_POLICY ?? "pairing";
    const channel = String(input.channel ?? "unknown");
    const sender = String(input.sender ?? "unknown");
    if (policy === "closed") return { allowed: false as const, error: "dm_policy_closed" };
    if (policy === "open") return { allowed: true as const };
    if (this.pairing.isAllowed(channel, sender)) return { allowed: true as const };
    const { code } = this.pairing.requestPairing(channel, sender);
    void this.memory
      .add("event", "pairing_required", { channel, sender, code })
      .catch(() => undefined);
    return { allowed: false as const, pairing: { code } };
  }

  listPendingPairings() {
    return this.pairing.listPending();
  }

  approvePairing(code: string) {
    return this.pairing.approve(code);
  }

  async replayToolCall(input: {
    tool: string;
    args: Record<string, any>;
    expectedHash: string;
    traceId?: string;
    approved?: boolean;
  }) {
    if (!this.permissions) throw new Error("Permissions not configured");
    const perms = this.permissions.getPermissions("autonomy_controller");
    const computed = (this.tools as any).computeArgsHash
      ? (this.tools as any).computeArgsHash(input.tool, input.args)
      : "";
    if (!computed || computed !== input.expectedHash) throw new Error("Args hash mismatch");
    const out = await this.tools.execute(input.tool, input.args, {
      userRole: "admin",
      permissions: perms,
      traceId: input.traceId,
      approved: input.approved,
      source: "audit_replay",
    });
    return { ok: true, output: out };
  }

  async runWorkflow(name: string, input: Record<string, unknown>) {
    this.metrics.counter("gateway_workflow_invocations_total").inc();
    return this.workflows.execute(name, input);
  }

  async ingestEvent(evt: EventEnvelope) {
    this.metrics.counter("events_ingested_total").inc();
    this.bus.emit("event.inbound", evt);
    await this.triggers.onEvent(evt);
    return { ok: true };
  }
}
