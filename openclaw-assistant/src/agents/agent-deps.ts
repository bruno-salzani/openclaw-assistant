import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { KnowledgeGraph } from "../knowledge-graph/graph.js";
import type { Tracer } from "../observability/tracing.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { InstructionFirewall } from "../security/instruction-firewall.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import type { PermissionManager } from "./security/permission-manager.js";
import type { EventBus } from "../infra/event-bus.js";
import type { PolicyService } from "../security/policy-service.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { AgentTracker } from "../observability/agent-tracker.js";

export type AgentDeps = {
  tools: ToolExecutionEngine;
  memory: MemorySystem;
  skills: SkillMarketplace;
  graph: KnowledgeGraph;
  tracer: Tracer;
  metrics: MetricsRegistry;
  aiObs?: AgentTracker;
  firewall: InstructionFirewall;
  queue: TaskQueue;
  permissions?: PermissionManager;
  bus?: EventBus;
  policy?: PolicyService;
  llm?: LLMProvider;
  learning?: {
    recordInteraction: (agent: string, input: string, output: string, ok: boolean) => Promise<void>;
  };
};
