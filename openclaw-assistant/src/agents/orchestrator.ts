import type { Agent, AgentContext, AgentResult, AgentRole } from "./types.js";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { KnowledgeGraph } from "../knowledge-graph/graph.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { Tracer } from "../observability/tracing.js";
import type { EventBus } from "../infra/event-bus.js";

export type OrchestratorDeps = {
  agents: Agent[];
  tools: ToolExecutionEngine;
  memory: MemorySystem;
  skills: SkillMarketplace;
  graph: KnowledgeGraph;
  tracer: Tracer;
  metrics: MetricsRegistry;
  bus?: EventBus;
};

export class AgentOrchestrator {
  private readonly agents: Map<AgentRole, Agent>;

  private readonly tracer: Tracer;

  private readonly metrics: MetricsRegistry;

  private readonly bus?: EventBus;

  constructor(deps: OrchestratorDeps) {
    this.agents = new Map(deps.agents.map((agent) => [agent.role, agent]));
    this.tracer = deps.tracer;
    this.metrics = deps.metrics;
    this.bus = deps.bus;
  }

  registerAgent(agent: Agent) {
    this.agents.set(agent.role, agent);
    this.bus?.emit("agent_spawned", { role: agent.role, id: (agent as any).id });
  }

  getAgent(role: AgentRole) {
    return this.agents.get(role);
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const span = this.tracer.startSpan("orchestrator.run", { sessionId: ctx.sessionId });
    try {
      this.bus?.emit("task_created", { sessionId: ctx.sessionId, text: ctx.text });
      this.metrics.counter("agent_runs_total").inc();
      const coordinator = this.agents.get("coordinator");
      if (!coordinator) {
        throw new Error("Coordinator agent not available");
      }
      this.bus?.emit("task_started", { sessionId: ctx.sessionId, agent: coordinator.role });
      const res = await coordinator.handle(ctx);
      this.bus?.emit("agent_finished", {
        role: coordinator.role,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        ok: true,
        objective: ctx.text,
      });
      return res;
    } catch (err) {
      this.bus?.emit("agent_finished", {
        role: "coordinator",
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        ok: false,
        objective: ctx.text,
        error: String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  }
}
