import type { Agent } from "./types.js";
import { PlannerAgent } from "./roles/planner-agent.js";
import { ResearchAgent } from "./roles/research-agent.js";
import { ExecutorAgent } from "./roles/executor-agent.js";
import { AnalystAgent } from "./roles/analyst-agent.js";
import { DocumentAgent } from "./roles/document-agent.js";
import { NotificationAgent } from "./roles/notification-agent.js";
import { AutomationAgent } from "./roles/automation-agent.js";
import { ReviewerAgent } from "./roles/reviewer-agent.js";
import { CoordinatorAgent } from "./roles/coordinator-agent.js";
import { FinanceAgent } from "./roles/finance-agent.js";
import { ReliabilityAgent } from "./roles/reliability-agent.js";
import { KnowledgeCuratorAgent } from "./roles/knowledge-curator-agent.js";
import { SimulationAgent } from "./roles/simulation-agent.js";
import { ExperimentAgent } from "./roles/experiment-agent.js";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { KnowledgeGraph } from "../knowledge-graph/graph.js";
import type { Tracer } from "../observability/tracing.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { defaultFirewall } from "../security/instruction-firewall.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import type { PermissionManager } from "./security/permission-manager.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { AgentTracker } from "../observability/agent-tracker.js";

export function buildDefaultAgents(deps: {
  tools: ToolExecutionEngine;
  memory: MemorySystem;
  skills: SkillMarketplace;
  graph: KnowledgeGraph;
  tracer: Tracer;
  metrics: MetricsRegistry;
  aiObs?: AgentTracker;
  queue: TaskQueue;
  llm?: LLMProvider;
  bus?: any;
  learning?: any;
  permissions?: PermissionManager;
  policy?: any;
}): Agent[] {
  const agentDeps = { ...deps, firewall: defaultFirewall };
  return [
    new PlannerAgent(agentDeps),
    new ResearchAgent(agentDeps),
    new ExecutorAgent(agentDeps),
    new FinanceAgent(agentDeps),
    new ReliabilityAgent(agentDeps),
    new KnowledgeCuratorAgent(agentDeps),
    new SimulationAgent(agentDeps),
    new ExperimentAgent(agentDeps),
    new AnalystAgent(agentDeps),
    new DocumentAgent(agentDeps),
    new NotificationAgent(agentDeps),
    new AutomationAgent(agentDeps),
    new ReviewerAgent(agentDeps),
    new CoordinatorAgent(agentDeps),
  ];
}
