/*
 * IA Assistant
 * Copyright (c) 2026 Bruno Salzani
 */

import { CoreGateway } from "./gateway/core-gateway.js";
import { AgentOrchestrator } from "./agents/orchestrator.js";
import { buildDefaultAgents } from "./agents/registry.js";
import { MemorySystem } from "./memory/memory-system.js";
import { ToolExecutionEngine } from "./tools/execution-engine.js";
import { ToolRegistry } from "./tools/registry/index.js";
import { SkillMarketplace } from "./skills/marketplace.js";
import { builtInSkills } from "./skills/builtin/index.js";
import { SkillRegistry as SkillManifestRegistry } from "./skills/registry.js";
import { installSkillManifests } from "./skills/installer.js";
import { WorkflowEngine } from "./workflows/engine.js";
import { realAutomations } from "./workflows/real-automations.js";
import { KnowledgeGraph } from "./knowledge-graph/graph.js";
import { InferenceEngine } from "./knowledge-graph/inference-engine.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { Tracer } from "./observability/tracing.js";
import { OTelHttpJsonExporter } from "./observability/otel-exporter.js";
import { AgentTracker, wrapLlmProvider } from "./observability/agent-tracker.js";
import { InMemoryTaskQueue } from "./tasks/inmemory-queue.js";
import { RedisTaskQueue } from "./tasks/redis-queue.js";
import type { TaskQueue } from "./tasks/task-queue.js";
import { TaskWorkerPool } from "./tasks/worker-pool.js";
import { PersistentTaskQueue } from "./tasks/persistent-queue.js";
import { TriggerEngine } from "./triggers/engine.js";
import type { TriggerSpec } from "./triggers/trigger-types.js";
import { TriggerDedupeStore } from "./triggers/dedupe-store.js";
import { loadOpenClawSkills } from "./integrations/openclaw/skills-adapter.js";
import { loadOpenClawPlugins } from "./integrations/openclaw/plugin-loader.js";
import { syncCronJobsIfEnabled } from "./integrations/openclaw/cron-adapter.js";
import { loadOpenClawTools } from "./openclaw/tools/loader.js";
import { EventBus } from "./infra/event-bus.js";
import { ContinualLearningLoop } from "./learning/continual/index.js";
import { KnowledgeMesh } from "./infra/knowledge-mesh.js";
import { AutonomyController } from "./autonomy/controller.js";
import { PermissionManager } from "./agents/security/permission-manager.js";
import { PolicyService } from "./security/policy-service.js";
import { defaultFirewall } from "./security/instruction-firewall.js";
import { ToolAuditLogger } from "./audit/tool-audit.js";
import { AgentEconomy } from "./economy/index.js";
import { ExperimentRunner } from "./experiments/experiment-runner.js";
import { RuntimeSupervisor } from "./runtime/supervisor.js";
import { AgentEvolutionEngine } from "./evolution/agent-evolution.js";
import {
  AnthropicProvider,
  LLMRouter,
  MistralProvider,
  OllamaProvider,
  OpenAIProvider,
} from "./llm/index.js";
import type { LLMProvider } from "./llm/llm-provider.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MarketplaceManager } from "./marketplace/manager.js";
import { EvolverService } from "./evolver/service.js";
import { AutoRefactorService } from "./self-improvement/auto-refactor.js";
import { SelfImprovementLoop } from "./self-improvement/loop.js";
import { SharedMemory } from "./distributed/shared-memory.js";
import { propose as consensusPropose, resolve as consensusResolve } from "./distributed/consensus.js";
import { AutonomousAgentManager } from "./autonomous/manager.js";
import { EpisodeStore } from "./memory/episodic/episode-store.js";
import {
  SkillExtractor,
  SkillRegistry,
  registerLearnedSkill,
  validateLearnedSkill,
  writeLearnedSkillTs,
} from "./agent-learning/index.js";
import { ToolProfiler, recommendTools } from "./tools/intelligence/index.js";
import { ImprovementEngine } from "./learning/index.js";
import { ModelRouterOptimizer } from "./optimization/index.js";
import { NodeRegistry } from "./distributed/node-registry.js";
import { DistributedTaskDispatcher } from "./distributed/task-dispatcher.js";
import { AgentProfileRegistry } from "./cognition/agent-profile-registry.js";
import { wrapLlmWithProfiles } from "./cognition/profiled-llm.js";
import { designArchitecture, designWorkflow, generateAgents } from "./meta-agent/index.js";
import { benchmarkModels, profileModels } from "./models/index.js";
import { analyzePromptDataset, mutatePrompt, PromptStore, scoreVariants } from "./prompt-evolution/index.js";
import { ReputationSystem, SwarmCoordinator, reachSwarmConsensus } from "./swarm/index.js";
import { planWithCognitiveTree } from "./reasoning/tree/index.js";
import { generateHypotheses, designExperiments, analyzeResults } from "./research/index.js";
import {
  PredictionEngine,
  KnowledgeState,
  OutcomePredictor,
  ScenarioSimulator,
  DecisionEvaluator,
} from "./world-model/index.js";
import { evaluateAnswer } from "./evaluation/index.js";
import { registerGameTools } from "./game/tools.js";

export class AIKernel {
  constructor(public readonly deps: {
    gateway: CoreGateway;
    orchestrator: AgentOrchestrator;
    workflows: WorkflowEngine;
    memory: MemorySystem;
    skills: SkillMarketplace;
    tools: ToolExecutionEngine;
    graph: KnowledgeGraph;
    queue: TaskQueue;
    metrics: MetricsRegistry;
    tracer: Tracer;
    bus: EventBus;
    llm?: LLMProvider;
  }, private readonly cleanup: () => void) {}

  async start(options?: { port?: number }) {
    if (options?.port) process.env.OPENCLAW_X_PORT = String(options.port);
    await this.deps.gateway.start();
    this.deps.bus.emit("system_started", { ts: Date.now() });
  }

  stop() {
    this.cleanup();
    this.deps.bus.emit("system_stopped", { ts: Date.now() });
  }

  get gateway() {
    return this.deps.gateway;
  }

  get orchestrator() {
    return this.deps.orchestrator;
  }

  get workflows() {
    return this.deps.workflows;
  }

  get memory() {
    return this.deps.memory;
  }

  get skills() {
    return this.deps.skills;
  }

  get tools() {
    return this.deps.tools;
  }

  get graph() {
    return this.deps.graph;
  }

  get queue() {
    return this.deps.queue;
  }

  get metrics() {
    return this.deps.metrics;
  }

  get tracer() {
    return this.deps.tracer;
  }

  get bus() {
    return this.deps.bus;
  }

  get llm() {
    return this.deps.llm;
  }
}

export async function createRuntime(): Promise<AIKernel> {
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  if (process.env.OPENCLAW_X_OTLP_URL) {
    tracer.setExporter(new OTelHttpJsonExporter(process.env.OPENCLAW_X_OTLP_URL));
  }

  const memory = new MemorySystem(metrics);
  const tools = new ToolExecutionEngine(metrics);
  tools.setAuditLogger(new ToolAuditLogger({ cwd: process.cwd() }));
  const toolRegistry = new ToolRegistry();
  tools.setToolRegistry(toolRegistry);
  registerGameTools({ tools, registry: toolRegistry });
  const skills = new SkillMarketplace(metrics);
  const graph = new KnowledgeGraph({ metrics, store: memory.getKnowledgeGraphStore() });
  if (process.env.IA_ASSISTANT_KG_INFERENCE_ENABLE === "1") {
    const inference = new InferenceEngine(graph);
    tools.registerTool("graph.infer", async (input: any) => {
      return inference.infer({
        query: String(input?.query ?? input?.text ?? ""),
        workspaceId: typeof input?.workspaceId === "string" ? String(input.workspaceId) : undefined,
        maxDepth: typeof input?.maxDepth === "number" ? Number(input.maxDepth) : undefined,
      });
    });
  }
  const bus = new EventBus();
  tools.setBus(bus);
  const aiObs = new AgentTracker({ metrics, tracer, bus });
  tools.setAgentTracker(aiObs);

  const sharedMemoryBackend = (process.env.IA_ASSISTANT_SHARED_MEMORY_BACKEND as any) as
    | "memory"
    | "file"
    | "redis"
    | undefined;
  const clusterEnabledNow = process.env.IA_ASSISTANT_CLUSTER_ENABLE === "1";
  const sharedMemoryRedisUrl =
    process.env.IA_ASSISTANT_SHARED_MEMORY_REDIS_URL ??
    process.env.OPENCLAW_X_TASKS_REDIS_URL ??
    process.env.OPENCLAW_X_REDIS_URL;
  const sharedMemory =
    sharedMemoryBackend === "redis" && !sharedMemoryRedisUrl
      ? new SharedMemory({ backend: "memory", namespace: "ia-assistant:shared", baseDir: process.cwd() })
      : new SharedMemory({
          backend:
            sharedMemoryBackend ??
            ((clusterEnabledNow && Boolean(sharedMemoryRedisUrl)) ? "redis" : "memory"),
          namespace: String(process.env.IA_ASSISTANT_SHARED_MEMORY_NAMESPACE ?? "ia-assistant:shared"),
          baseDir: process.cwd(),
          redisUrl: sharedMemoryRedisUrl,
        });
  tools.registerTool("shared_memory.get", async (input: any) => {
    const key = String(input?.key ?? "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    const entry = await sharedMemory.get(key);
    return { ok: true, entry };
  });
  tools.registerTool("shared_memory.set", async (input: any) => {
    const key = String(input?.key ?? "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    const ttlMs = typeof input?.ttlMs === "number" ? Number(input.ttlMs) : undefined;
    const entry = await sharedMemory.set(key, input?.value, ttlMs);
    return { ok: true, entry };
  });
  tools.registerTool("shared_memory.del", async (input: any) => {
    const key = String(input?.key ?? "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    const removed = await sharedMemory.del(key);
    return { ok: true, removed };
  });
  tools.registerTool("shared_memory.keys", async (input: any) => {
    const prefix = typeof input?.prefix === "string" ? String(input.prefix) : "";
    const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
    const keys = await sharedMemory.keys(prefix, limit);
    return { ok: true, keys };
  });
  tools.registerTool("shared_memory.lock.acquire", async (input: any) => {
    const key = String(input?.key ?? "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    const owner = typeof input?.owner === "string" ? String(input.owner) : randomUUID();
    const ttlMs = typeof input?.ttlMs === "number" ? Number(input.ttlMs) : undefined;
    const ok = await sharedMemory.acquireLock(key, owner, ttlMs);
    return { ok: true, acquired: ok, owner };
  });
  tools.registerTool("shared_memory.lock.release", async (input: any) => {
    const key = String(input?.key ?? "").trim();
    const owner = String(input?.owner ?? "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    if (!owner) return { ok: false, error: "missing_owner" };
    const ok = await sharedMemory.releaseLock(key, owner);
    return { ok: true, released: ok };
  });

  tools.registerTool("consensus.propose", async (input: any) => {
    const topic = String(input?.topic ?? "").trim();
    if (!topic) return { ok: false, error: "missing_topic" };
    const id = typeof input?.id === "string" ? String(input.id) : undefined;
    const score = typeof input?.score === "number" ? Number(input.score) : undefined;
    const ttlMs = typeof input?.ttlMs === "number" ? Number(input.ttlMs) : undefined;
    const out = await consensusPropose({ shared: sharedMemory, topic, id, score, ttlMs, value: input?.value });
    return out;
  });
  tools.registerTool("consensus.resolve", async (input: any) => {
    const topic = String(input?.topic ?? "").trim();
    if (!topic) return { ok: false, error: "missing_topic" };
    return consensusResolve({ shared: sharedMemory, topic });
  });

  const economy = new AgentEconomy(process.cwd());
  economy.load();
  bus.on("ai.observability", (evt: any) => {
    try {
      economy.onAgentObs(evt);
      economy.save();
    } catch {}
  });
  bus.on("tool.executed", (evt: any) => {
    try {
      economy.onToolExecuted(evt);
      economy.save();
    } catch {}
  });
  tools.registerTool("economy.agents", async (input: any) => {
    const limit = typeof input?.limit === "number" ? Number(input.limit) : 200;
    return { ok: true, agents: economy.list(limit) };
  });

  const agentEvolutionEnabled = process.env.IA_ASSISTANT_AGENT_EVOLUTION_ENABLE === "1";
  const agentEvolution = agentEvolutionEnabled
    ? new AgentEvolutionEngine({ metrics, memory, economy, repoRoot: process.cwd() })
    : null;
  tools.registerTool("agent_evolution.run_once", async (input: any) => {
    if (!agentEvolution) return { ok: false, error: "disabled" };
    const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
    const outDir = typeof input?.outDir === "string" ? String(input.outDir) : undefined;
    return agentEvolution.runOnce({ limit, outDir });
  });

  const episodes = new EpisodeStore({ memory });
  bus.on("agent_finished", (evt: any) => {
    const objective = typeof evt?.objective === "string" ? String(evt.objective) : "";
    const sessionId = typeof evt?.sessionId === "string" ? String(evt.sessionId) : undefined;
    const userId = typeof evt?.userId === "string" ? String(evt.userId) : undefined;
    if (!objective.trim()) return;
    void episodes
      .record({
        id: typeof evt?.traceId === "string" ? String(evt.traceId) : undefined,
        kind: "interaction",
        objective,
        sessionId,
        userId,
        ok: Boolean(evt?.ok),
        score: Boolean(evt?.ok) ? 1 : 0,
        result: { role: evt?.role, error: evt?.error },
      })
      .catch(() => undefined);
  });

  tools.registerTool("episodic.record", async (input: any) => {
    const objective = String(input?.objective ?? input?.goal ?? "");
    if (!objective.trim()) return { ok: false, error: "missing_objective" };
    const lessons = Array.isArray(input?.lessons) ? input.lessons.map(String).filter(Boolean) : undefined;
    const tags = Array.isArray(input?.tags) ? input.tags.map(String).filter(Boolean) : undefined;
    const score = typeof input?.score === "number" ? Number(input.score) : undefined;
    const ok = typeof input?.ok === "boolean" ? Boolean(input.ok) : undefined;
    const sessionId = typeof input?.sessionId === "string" ? String(input.sessionId) : undefined;
    const userId = typeof input?.userId === "string" ? String(input.userId) : undefined;
    const workspaceId = typeof input?.workspaceId === "string" ? String(input.workspaceId) : undefined;
    return episodes.record({
      kind: String(input?.kind ?? "manual"),
      objective,
      sessionId,
      userId,
      workspaceId,
      ok,
      score,
      lessons,
      tags,
      plan: input?.plan,
      actions: input?.actions,
      result: input?.result,
    });
  });
  tools.registerTool("episodic.search", async (input: any) => {
    const query = String(input?.query ?? "");
    const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
    const type = input?.type === "exact" ? "exact" : "semantic";
    const workspaceId = typeof input?.workspaceId === "string" ? String(input.workspaceId) : undefined;
    const userId = typeof input?.userId === "string" ? String(input.userId) : undefined;
    return episodes.search({ query, limit, type, workspaceId, userId });
  });
  tools.registerTool("episodic.latest", async (input: any) => {
    const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
    return episodes.latest({ limit });
  });

  let swarmReputationTimer: any = null;
  let swarmReputation: ReputationSystem | null = null;
  if (process.env.IA_ASSISTANT_EMERGENT_SWARM_ENABLE === "1") {
    const rep = new ReputationSystem(process.cwd());
    rep.load();
    swarmReputation = rep;
    bus.on("ai.observability", (evt: any) => {
      try {
        rep.onAgentObs(evt);
      } catch {}
    });
    const flushMs = Number(process.env.IA_ASSISTANT_SWARM_REPUTATION_FLUSH_MS ?? 60_000);
    swarmReputationTimer = setInterval(() => {
      try {
        rep.save();
      } catch {}
    }, Number.isFinite(flushMs) ? Math.max(5000, flushMs) : 60_000);
  }

  const longTermLearningEnabled = process.env.IA_ASSISTANT_LONGTERM_LEARNING_ENABLE === "1";
  const improvement = longTermLearningEnabled
    ? new ImprovementEngine({ bus, memory, baseDir: process.cwd() })
    : null;
  improvement?.start();
  if (longTermLearningEnabled) {
    tools.registerTool("learning.stats", async (input: any) => {
      const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
      return improvement?.stats(limit ?? 10_000) ?? { ok: true, events: 0, counters: {}, examples: 0 };
    });
    tools.registerTool("learning.dataset.export", async (input: any) => {
      const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
      return improvement?.exportTrainingDataset({ limit }) ?? { ok: false, error: "disabled" };
    });
    tools.registerTool("learning.user_correction", async (input: any) => {
      return improvement?.recordUserCorrection({
        sessionId: typeof input?.sessionId === "string" ? String(input.sessionId) : undefined,
        userId: typeof input?.userId === "string" ? String(input.userId) : undefined,
        traceId: typeof input?.traceId === "string" ? String(input.traceId) : undefined,
        prompt: String(input?.prompt ?? ""),
        answer: String(input?.answer ?? ""),
        correction: String(input?.correction ?? ""),
      });
    });
  }

  const toolIntelligenceEnabled = process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_ENABLE === "1";
  const toolProfiler = toolIntelligenceEnabled
    ? new ToolProfiler(
        { bus, memory },
        {
          latencyWindow: Number(process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_LATENCY_WINDOW ?? 120),
          flushEveryMs: Number(process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_FLUSH_MS ?? 60_000),
        }
      )
    : null;
  toolProfiler?.start();
  if (toolIntelligenceEnabled) {
    tools.registerTool("tool_intelligence.stats", async (input: any) => {
      const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
      return { ok: true, profiles: toolProfiler?.snapshot({ limit }) ?? [] };
    });
    tools.registerTool("tool_intelligence.recommend", async (input: any) => {
      const profiles = toolProfiler?.snapshot({ limit: 500 }) ?? [];
      const candidates = Array.isArray(input?.candidates) ? input.candidates.map(String) : undefined;
      const query = typeof input?.query === "string" ? String(input.query) : undefined;
      const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
      return recommendTools({ profiles, candidates, query, limit });
    });
  }

  const optimizerEnabled = process.env.IA_ASSISTANT_OPTIMIZER_ENABLE === "1";
  const modelRouterOptimizer = optimizerEnabled
    ? new ModelRouterOptimizer(
        { bus, baseDir: process.cwd() },
        {
          budgetUsdPerRun: Number(process.env.IA_ASSISTANT_OPTIMIZER_BUDGET_USD_PER_RUN ?? 0.002),
          window: Number(process.env.IA_ASSISTANT_OPTIMIZER_WINDOW ?? 40),
          evaluateEveryMs: Number(process.env.IA_ASSISTANT_OPTIMIZER_EVAL_MS ?? 30_000),
        }
      )
    : null;
  modelRouterOptimizer?.start();

  if (optimizerEnabled) {
    tools.registerTool("optimization.status", async () => ({
      ok: true,
      modelRouter: modelRouterOptimizer?.getState() ?? null,
      env: {
        IA_ASSISTANT_LLM_REASONING_MIN_CHARS: process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS,
        IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS: process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS,
      },
    }));
    tools.registerTool("optimization.model_router.evaluate", async () => {
      return modelRouterOptimizer?.evaluateAndApply() ?? { ok: false, error: "disabled" };
    });
  }

  const llmEnabled = process.env.IA_ASSISTANT_LLM_ENABLE === "1";
  const llmRaw = (() => {
    if (!llmEnabled) return undefined;

    const openaiApiKey = String(process.env.OPENAI_API_KEY ?? "");
    const openaiModel = String(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    const openaiRaw =
      openaiApiKey.trim() && openaiModel.trim()
        ? new OpenAIProvider({
            name: "openai",
            apiKey: openaiApiKey,
            model: openaiModel,
            baseUrl: openaiBaseUrl,
          })
        : undefined;
    const openai = openaiRaw
      ? wrapLlmProvider({ base: openaiRaw, model: openaiModel, tracker: aiObs })
      : undefined;

    const deepseekApiKey = String(process.env.DEEPSEEK_API_KEY ?? "");
    const deepseekModel = String(process.env.DEEPSEEK_MODEL ?? "deepseek-coder");
    const deepseekBaseUrl = String(process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com");
    const deepseekRaw =
      deepseekApiKey.trim() && deepseekModel.trim()
        ? new OpenAIProvider({
            name: "deepseek",
            apiKey: deepseekApiKey,
            model: deepseekModel,
            baseUrl: deepseekBaseUrl,
          })
        : undefined;
    const deepseek = deepseekRaw
      ? wrapLlmProvider({ base: deepseekRaw, model: deepseekModel, tracker: aiObs })
      : undefined;

    const mistralApiKey = String(process.env.MISTRAL_API_KEY ?? "");
    const mistralModel = String(process.env.MISTRAL_MODEL ?? "mistral-small-latest");
    const mistralRaw =
      mistralApiKey.trim() && mistralModel.trim()
        ? new MistralProvider({ apiKey: mistralApiKey, model: mistralModel })
        : undefined;
    const mistral = mistralRaw
      ? wrapLlmProvider({ base: mistralRaw, model: mistralModel, tracker: aiObs })
      : undefined;

    const anthropicApiKey = String(process.env.ANTHROPIC_API_KEY ?? "");
    const anthropicModel = String(process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest");
    const anthropicRaw =
      anthropicApiKey.trim() && anthropicModel.trim()
        ? new AnthropicProvider({ apiKey: anthropicApiKey, model: anthropicModel })
        : undefined;
    const anthropic = anthropicRaw
      ? wrapLlmProvider({ base: anthropicRaw, model: anthropicModel, tracker: aiObs })
      : undefined;

    const ollamaModel = String(process.env.OLLAMA_MODEL ?? "");
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
    const ollamaRaw = ollamaModel.trim()
      ? new OllamaProvider({ model: ollamaModel, baseUrl: ollamaBaseUrl })
      : undefined;
    const ollama = ollamaRaw
      ? wrapLlmProvider({ base: ollamaRaw, model: ollamaModel, tracker: aiObs })
      : undefined;

    const coding =
      deepseek ??
      (openaiApiKey.trim()
        ? wrapLlmProvider({
            base: new OpenAIProvider({
              name: "openai-coder",
              apiKey: openaiApiKey,
              model: String(process.env.OPENAI_CODER_MODEL ?? openaiModel),
              baseUrl: openaiBaseUrl,
            }),
            model: String(process.env.OPENAI_CODER_MODEL ?? openaiModel),
            tracker: aiObs,
          })
        : undefined);

    const fallback = ollama ?? openai ?? mistral ?? anthropic;
    if (!fallback) return undefined;

    return new LLMRouter({
      cheap: mistral ?? ollama ?? openai,
      reasoning: anthropic ?? openai ?? mistral ?? ollama,
      coding: coding ?? openai ?? mistral ?? ollama,
      offline: ollama,
      default: openai ?? mistral ?? anthropic ?? ollama,
      fallback,
      bus,
    });
  })();
  const llm = llmRaw
    ? wrapLlmWithProfiles({
        base: llmRaw,
        tracker: aiObs,
        profiles: new AgentProfileRegistry({ baseDir: process.cwd() }),
      })
    : undefined;

  tools.registerTool("evaluation.run", async (input: any) => {
    const prompt = String(input?.prompt ?? input?.objective ?? "");
    const answer = String(input?.answer ?? "");
    const contextText = typeof input?.contextText === "string" ? String(input.contextText) : undefined;
    if (!prompt.trim() || !answer.trim()) return { ok: false, error: "missing_prompt_or_answer" };
    const out = await evaluateAnswer({ llm, prompt, answer, contextText });
    return { ok: true, evaluation: out };
  });
  const modelIntelligenceEnabled = process.env.IA_ASSISTANT_MODEL_INTELLIGENCE_ENABLE === "1";
  if (modelIntelligenceEnabled && llmRaw) {
    tools.registerTool("models.providers", async () => {
      return { ok: true, providers: (llmRaw as any).listConfiguredProviders?.() ?? {} };
    });
    tools.registerTool("models.profile", async (input: any) => {
      const limit = typeof input?.limit === "number" ? Number(input.limit) : 500;
      return { ok: true, models: profileModels({ tracker: aiObs, limit }) };
    });
    tools.registerTool("models.benchmark", async (input: any) => {
      const routes = Array.isArray(input?.routes)
        ? input.routes
            .map(String)
            .filter((r: string) => ["cheap", "reasoning", "coding", "offline", "default"].includes(r))
        : ["cheap", "reasoning", "coding"];
      const casesIn = Array.isArray(input?.cases) ? input.cases : [];
      const cases = casesIn
        .map((c: any, i: number) => ({
          id: typeof c?.id === "string" ? c.id : `c${i + 1}`,
          messages: Array.isArray(c?.messages)
            ? c.messages
            : [{ role: "user", content: typeof c?.text === "string" ? c.text : String(c ?? "") }],
          expectedContains: typeof c?.expectedContains === "string" ? c.expectedContains : undefined,
        }))
        .slice(0, 30);
      return benchmarkModels({ router: llmRaw as any, routes: routes as any, cases });
    });
  }

  if (process.env.IA_ASSISTANT_PROMPT_EVOLUTION_ENABLE === "1") {
    const store = new PromptStore(process.cwd());
    tools.registerTool("prompt_evolution.analyze_dataset", async (input: any) => {
      const datasetPath = String(input?.datasetPath ?? "");
      const limit = typeof input?.limit === "number" ? Number(input.limit) : undefined;
      if (!datasetPath.trim()) return { ok: false, error: "missing_datasetPath" };
      return analyzePromptDataset({ datasetPath, limit });
    });
    tools.registerTool("prompt_evolution.evolve", async (input: any) => {
      const key = String(input?.key ?? "default");
      const basePrompt = String(input?.prompt ?? store.latestByKey(key)?.text ?? "");
      if (!basePrompt.trim()) return { ok: false, error: "missing_prompt" };
      const variants = await mutatePrompt({
        prompt: basePrompt,
        llm,
        variants: typeof input?.variants === "number" ? Number(input.variants) : undefined,
      });
      const scores = await scoreVariants({ variants, llm });
      const best = scores.slice().sort((a, b) => b.score - a.score)[0];
      const picked = variants.find((v) => v.id === best?.variantId) ?? variants[0]!;
      const saved = store.upsert({
        id: `${key}:${picked.id}:${Date.now()}`,
        key,
        text: picked.text,
        score: best?.score,
        ts: Date.now(),
        meta: { reasons: best?.reasons ?? [], variant: picked.meta ?? {} },
      });
      return { ok: true, best: { ...best, text: picked.text }, saved };
    });
    tools.registerTool("prompt_evolution.latest", async (input: any) => {
      const key = String(input?.key ?? "default");
      return { ok: true, latest: store.latestByKey(key) };
    });
  }

  if (process.env.IA_ASSISTANT_COGNITIVE_TREE_ENABLE === "1") {
    tools.registerTool("reasoning.tree.plan", async (input: any) => {
      const objective = String(input?.objective ?? "");
      if (!objective.trim()) return { ok: false, error: "missing_objective" };
      return planWithCognitiveTree({
        llm: llm!,
        objective,
        contextText: input?.contextText,
        branches: input?.branches,
        depth: input?.depth,
      });
    });
  }

  if (process.env.IA_ASSISTANT_RESEARCH_LOOP_ENABLE === "1") {
    tools.registerTool("research.hypothesis", async (input: any) => {
      const topic = String(input?.topic ?? "");
      const max = typeof input?.max === "number" ? Number(input.max) : undefined;
      return { ok: true, hypotheses: generateHypotheses({ topic, max }) };
    });
    tools.registerTool("research.experiment", async (input: any) => {
      const hypotheses = Array.isArray(input?.hypotheses) ? input.hypotheses : [];
      const max = typeof input?.max === "number" ? Number(input.max) : undefined;
      return { ok: true, experiments: designExperiments({ hypotheses, max }) };
    });
    tools.registerTool("research.analyze", async (input: any) => {
      const topic = String(input?.topic ?? "");
      const experiments = Array.isArray(input?.experiments) ? input.experiments : [];
      const results = Array.isArray(input?.results) ? input.results : [];
      return { ok: true, findings: await analyzeResults({ topic, experiments, results, llm }) };
    });
  }

  if (process.env.IA_ASSISTANT_EMERGENT_SWARM_ENABLE === "1") {
    tools.registerTool("swarm.coordinate", async (input: any) => {
      const task = String(input?.task ?? "");
      const proposalsIn = Array.isArray(input?.proposals) ? input.proposals : [];
      const proposals = proposalsIn
        .map((p: any, i: number) => ({
          id: typeof p?.id === "string" ? String(p.id) : `p${i + 1}`,
          agent: typeof p?.agent === "string" ? String(p.agent) : "unknown",
          text: typeof p?.text === "string" ? String(p.text) : String(p ?? ""),
        }))
        .filter((p: any) => Boolean(p.text && String(p.text).trim()))
        .slice(0, 12);
      if (!task.trim() || proposals.length === 0) return { ok: false, error: "missing_task_or_proposals" };

      const rep = swarmReputation ?? new ReputationSystem(process.cwd());
      if (!swarmReputation) rep.load();
      const coordinator = new SwarmCoordinator({ llm, memory, reputation: rep });
      const out = await coordinator.debate({
        task,
        proposals,
        reputationWeight: typeof input?.reputationWeight === "number" ? Number(input.reputationWeight) : undefined,
      });
      return { ok: true, debate: out.debate, consensus: out.consensus };
    });
    tools.registerTool("swarm.consensus", async (input: any) => {
      const proposalsIn = Array.isArray(input?.proposals) ? input.proposals : [];
      const proposals = proposalsIn
        .map((p: any, i: number) => ({
          id: typeof p?.id === "string" ? String(p.id) : `p${i + 1}`,
          agent: typeof p?.agent === "string" ? String(p.agent) : "unknown",
          text: typeof p?.text === "string" ? String(p.text) : String(p ?? ""),
        }))
        .filter((p: any) => Boolean(p.text && String(p.text).trim()))
        .slice(0, 20);
      const baseScoresIn = Array.isArray(input?.baseScores) ? input.baseScores : [];
      const baseScores = baseScoresIn
        .map((s: any) => ({
          proposalId: String(s?.proposalId ?? ""),
          score: Number(s?.score ?? 0),
        }))
        .filter((s: any) => Boolean(s.proposalId));
      if (proposals.length === 0 || baseScores.length === 0) {
        return { ok: false, error: "missing_proposals_or_baseScores" };
      }

      const rep = swarmReputation ?? new ReputationSystem(process.cwd());
      if (!swarmReputation) rep.load();
      const consensus = reachSwarmConsensus({
        proposals,
        baseScores,
        reputation: (agent) => rep.get(agent),
        reputationWeight: typeof input?.reputationWeight === "number" ? Number(input.reputationWeight) : undefined,
      });
      return { ok: true, consensus };
     });
   }

  if (process.env.IA_ASSISTANT_WORLD_MODEL_ENABLE === "1") {
    const state = new KnowledgeState({ memory });
    const predictor = new PredictionEngine({ llm });

    bus.on("agent_finished", (evt: any) => {
      const sessionId = typeof evt?.sessionId === "string" ? evt.sessionId : "";
      const userId = typeof evt?.userId === "string" ? evt.userId : "";
      const objective = typeof evt?.objective === "string" ? evt.objective : "";
      if (!sessionId || !userId || !objective) return;
      void state
        .ingest({
          type: "interaction",
          ts: Date.now(),
          sessionId,
          userId,
          objective,
          outcomeOk: Boolean(evt?.ok),
        })
        .catch(() => undefined);
    });

    tools.registerTool("world.state", async () => ({ ok: true, snapshot: state.snapshot() }));
    tools.registerTool("world.predict", async (input: any) => {
      const objective = String(input?.objective ?? input?.scenario ?? input?.goal ?? "");
      if (!objective.trim()) return { ok: false, error: "missing_objective" };
      const prediction = await predictor.predict({ objective, knowledge: state.snapshot() });
      return { ok: true, prediction };
    });
    tools.registerTool("world.evaluate_decision", async (input: any) => {
      const objective = String(input?.objective ?? "");
      const plansIn = Array.isArray(input?.plans) ? input.plans : [];
      const plans = plansIn
        .map((p: any, i: number) => ({
          id: typeof p?.id === "string" ? String(p.id) : `p${i + 1}`,
          text: typeof p?.text === "string" ? String(p.text) : String(p?.plan ?? p ?? ""),
        }))
        .filter((p: any) => Boolean(p.text && String(p.text).trim()))
        .slice(0, 12);
      if (!objective.trim() || plans.length === 0) return { ok: false, error: "missing_objective_or_plans" };

      const outcomePredictor = new OutcomePredictor({ llm });
      const simulator = new ScenarioSimulator({ state, predictor: outcomePredictor });
      const sim = await simulator.simulate({ id: `s:${Date.now()}`, objective, plans });
      const decision = DecisionEvaluator(sim);
      return { ok: true, simulation: sim, decision };
    });
  }

   const baseQueue: TaskQueue = process.env.OPENCLAW_X_TASKS_REDIS_URL
    ? new RedisTaskQueue(process.env.OPENCLAW_X_TASKS_REDIS_URL)
    : new InMemoryTaskQueue();
  const basePersistentQueue: TaskQueue = new PersistentTaskQueue({ base: baseQueue, memory });

  const clusterEnabled =
    process.env.IA_ASSISTANT_CLUSTER_ENABLE === "1" && Boolean(process.env.OPENCLAW_X_TASKS_REDIS_URL);
  const clusterRole = String(process.env.IA_ASSISTANT_CLUSTER_ROLE ?? "all").toLowerCase();
  const clusterNodeId = String(process.env.IA_ASSISTANT_CLUSTER_NODE_ID ?? "").trim() || randomUUID();
  if (clusterEnabled && !process.env.IA_ASSISTANT_CLUSTER_NODE_ID) {
    process.env.IA_ASSISTANT_CLUSTER_NODE_ID = clusterNodeId;
  }
  const clusterRedisUrl =
    String(process.env.IA_ASSISTANT_CLUSTER_REDIS_URL ?? "").trim() ||
    String(process.env.OPENCLAW_X_TASKS_REDIS_URL ?? "");
  const nodeRegistry = clusterEnabled && clusterRedisUrl ? new NodeRegistry({ redisUrl: clusterRedisUrl }) : null;

  const queue: TaskQueue =
    clusterEnabled && nodeRegistry
      ? new DistributedTaskDispatcher({
          base: basePersistentQueue,
          registry: nodeRegistry,
          bus,
          strategy: (process.env.IA_ASSISTANT_CLUSTER_LB_STRATEGY as any) ?? "least_busy",
          staleMs: Number(process.env.IA_ASSISTANT_CLUSTER_STALE_MS ?? 15_000),
          workerNodeId: clusterNodeId,
          enforceAssignment: clusterRole === "worker" && process.env.IA_ASSISTANT_CLUSTER_ENFORCE_ASSIGNMENT === "1",
        })
      : basePersistentQueue;

  const workflows = new WorkflowEngine(metrics, tools, memory, queue);
  const dedupe = new TriggerDedupeStore(
    process.env.OPENCLAW_X_TASKS_REDIS_URL ?? process.env.OPENCLAW_X_REDIS_URL
  );
  const triggers = new TriggerEngine(metrics, workflows, dedupe);

  for (const workflow of realAutomations) {
    workflows.register(workflow);
  }

  for (const skill of builtInSkills) {
    skills.register(skill);
  }
  if (process.env.IA_ASSISTANT_SKILL_REGISTRY_ENABLE === "1") {
    const registry = new SkillManifestRegistry(process.cwd());
    const state = registry.read();
    installSkillManifests({ marketplace: skills, metrics, manifests: state.skills });
  }
  skills.registerTools((name, handler) => tools.registerTool(name, handler));

  const openclawRepoCandidates = [
    process.env.OPENCLAW_REPO_PATH,
    path.resolve(process.cwd(), "..", "openclaw"),
    path.resolve(process.cwd(), "..", "..", "openclaw"),
    path.resolve(process.cwd(), "..", "..", "..", "openclaw"),
  ].filter((p): p is string => Boolean(p && String(p).trim()));
  const openclawRepo = openclawRepoCandidates.find((p) => fs.existsSync(p));
  if (openclawRepo) {
    loadOpenClawSkills(openclawRepo, skills, metrics);
    loadOpenClawPlugins(openclawRepo, skills, metrics);
    skills.registerTools((name, handler) => tools.registerTool(name, handler));
    await syncCronJobsIfEnabled(openclawRepo, metrics, memory);
  }

  if (String(process.env.IA_ASSISTANT_OPENCLAW_TOOL_PROTOCOL ?? "0") === "1") {
    const extensionsCandidates = [
      process.env.IA_ASSISTANT_OPENCLAW_EXTENSIONS_DIR,
      path.resolve(process.cwd(), "openclaw", "extensions"),
      openclawRepo ? path.join(openclawRepo, "extensions") : undefined,
    ].filter((p): p is string => Boolean(p && String(p).trim()));
    const extensionsDir = extensionsCandidates.find((p) => fs.existsSync(p));
    if (extensionsDir) {
      await loadOpenClawTools({
        extensionsDir,
        metrics,
        engine: tools,
        manifestRegistry: toolRegistry,
        bustImportCache: true,
      });
    }
  }

  if (process.env.IA_ASSISTANT_TOOL_MARKETPLACE !== "0") {
    const { loadToolMarketplace } = await import("./tools/marketplace/index.js");
    await loadToolMarketplace({
      tools,
      registry: toolRegistry,
      metrics,
    });
  }

  await memory.init();
  const shouldRunRuntimeLoopsEarly = !clusterEnabled || clusterRole === "all" || clusterRole === "runtime";
  if (shouldRunRuntimeLoopsEarly && process.env.IA_ASSISTANT_RECOVER_TASKS_ON_STARTUP !== "0") {
    try {
      await memory.recoverTasks({ queue, limit: Number(process.env.IA_ASSISTANT_RECOVER_TASKS_LIMIT ?? 200) });
    } catch {}
  }

  const permissions = new PermissionManager({
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    aiObs,
    firewall: defaultFirewall,
    queue,
    bus,
    llm,
  });
  workflows.setPermissions(permissions);
  const policy = new PolicyService({ metrics, memory, bus });
  tools.setPolicy(policy);

  const learning = new ContinualLearningLoop({
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    aiObs,
    firewall: defaultFirewall,
    queue,
    permissions,
    policy,
    llm,
  });

  const skillLearningEnabled = process.env.IA_ASSISTANT_SKILL_LEARNING_ENABLE === "1";
  if (skillLearningEnabled) {
    const registry = new SkillRegistry(process.cwd());
    const depsForSkills: any = {
      tools,
      memory,
      skills,
      graph,
      tracer,
      metrics,
      aiObs,
      firewall: defaultFirewall,
      queue,
      permissions,
      bus,
      policy,
      llm,
      learning,
    };

    const active = registry.list({ status: "active" });
    for (const s of active) {
      const v = validateLearnedSkill({ spec: s, toolRegistry });
      if (v.ok) registerLearnedSkill({ deps: depsForSkills, spec: s });
    }

    const extractor = new SkillExtractor({
      threshold: Number(process.env.IA_ASSISTANT_SKILL_LEARNING_THRESHOLD ?? 10),
      maxKeys: 10,
    });
    bus.on("tool.executed", async (evt: any) => {
      const suggestion = extractor.observe(evt);
      if (!suggestion) return;
      const exists = registry.get(suggestion.id);
      if (exists) return;
      const stored = registry.upsert({
        id: suggestion.id,
        description: suggestion.description,
        steps: suggestion.steps,
        status: "pending",
        meta: suggestion.meta,
      } as any);
      await memory.add("event", "skill_suggested", stored as any);
      if (process.env.IA_ASSISTANT_SKILL_LEARNING_AUTO_REGISTER === "1") {
        const v = validateLearnedSkill({ spec: stored as any, toolRegistry });
        if (v.ok) {
          const updated = registry.upsert({ ...(stored as any), status: "active" });
          registerLearnedSkill({ deps: depsForSkills, spec: updated as any });
          if (process.env.IA_ASSISTANT_SKILL_LEARNING_WRITE_TS === "1") {
            writeLearnedSkillTs({ baseDir: process.cwd(), spec: updated as any });
          }
          await memory.add("event", "skill_registered", { id: updated?.id });
        }
      }
    });

    tools.registerTool("skill_learning.list", async () => {
      return { ok: true, skills: registry.list() };
    });
    tools.registerTool("skill_learning.approve", async (input: any) => {
      const id = String(input?.id ?? "");
      const s = registry.get(id);
      if (!s) return { ok: false, error: "not_found" };
      const v = validateLearnedSkill({ spec: s, toolRegistry });
      if (!v.ok) return { ok: false, error: "invalid", validation: v };
      const updated = registry.upsert({ ...(s as any), status: "active" });
      registerLearnedSkill({ deps: depsForSkills, spec: updated as any });
      if (process.env.IA_ASSISTANT_SKILL_LEARNING_WRITE_TS === "1") {
        writeLearnedSkillTs({ baseDir: process.cwd(), spec: updated as any });
      }
      await memory.add("event", "skill_approved", { id: updated?.id });
      return { ok: true, skill: updated };
    });
    tools.registerTool("skill_learning.reject", async (input: any) => {
      const id = String(input?.id ?? "");
      const s = registry.get(id);
      if (!s) return { ok: false, error: "not_found" };
      const updated = registry.upsert({ ...(s as any), status: "rejected" });
      await memory.add("event", "skill_rejected", { id: updated?.id });
      return { ok: true, skill: updated };
    });
    tools.registerTool("skill_learning.create", async (input: any) => {
      const spec = {
        id: String(input?.id ?? ""),
        description: String(input?.description ?? "Learned skill"),
        steps: Array.isArray(input?.steps) ? input.steps : [],
        status: "active" as const,
      };
      const v = validateLearnedSkill({ spec, toolRegistry });
      if (!v.ok) return { ok: false, error: "invalid", validation: v };
      const saved = registry.upsert(spec as any);
      registerLearnedSkill({ deps: depsForSkills, spec: saved as any });
      if (process.env.IA_ASSISTANT_SKILL_LEARNING_WRITE_TS === "1") {
        writeLearnedSkillTs({ baseDir: process.cwd(), spec: saved as any });
      }
      await memory.add("event", "skill_created", { id: saved?.id });
      return { ok: true, skill: saved };
    });
  }
  const mesh = new KnowledgeMesh({
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    aiObs,
    firewall: defaultFirewall,
    queue,
    permissions,
    policy,
    llm,
  });

  const agents = buildDefaultAgents({
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    aiObs,
    queue,
    bus,
    learning,
    permissions,
    policy,
    llm,
  });
  const orchestrator = new AgentOrchestrator({
    agents,
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    bus,
  });
  if (process.env.IA_ASSISTANT_EXPERIMENTS_ENABLE === "1") {
    const runner = new ExperimentRunner({ orchestrator });
    tools.registerTool("experiments.ab_test", async (input: any) => {
      const prompts = Array.isArray(input?.prompts) ? input.prompts : [];
      const normalized = prompts
        .map((p: any, i: number) => ({
          id: typeof p?.id === "string" ? String(p.id) : `p${i + 1}`,
          text: typeof p?.text === "string" ? String(p.text) : String(p ?? ""),
        }))
        .filter((p: any) => Boolean(p.text && String(p.text).trim()))
        .slice(0, 200);
      const variantA = input?.variantA && typeof input.variantA === "object" ? input.variantA : {};
      const variantB = input?.variantB && typeof input.variantB === "object" ? input.variantB : {};
      return runner.abTest(normalized, {
        sessionId: typeof input?.sessionId === "string" ? String(input.sessionId) : undefined,
        userId: typeof input?.userId === "string" ? String(input.userId) : undefined,
        channel: "experiments",
        workspaceId: typeof input?.workspaceId === "string" ? String(input.workspaceId) : undefined,
        variantA: { id: String(variantA?.id ?? "A"), system: typeof variantA?.system === "string" ? variantA.system : undefined },
        variantB: { id: String(variantB?.id ?? "B"), system: typeof variantB?.system === "string" ? variantB.system : undefined },
      });
    });
  }

  const workerPool = new TaskWorkerPool({ queue, agents, tracer, metrics, memory });
  if (process.env.IA_ASSISTANT_META_AGENT_ENABLE === "1") {
    const depsForGenerated = {
      tools,
      memory,
      skills,
      graph,
      tracer,
      metrics,
      aiObs,
      firewall: defaultFirewall,
      queue,
      permissions,
      bus,
      policy,
      llm,
      learning,
    };
    tools.registerTool("meta.design_architecture", async (input: any) => {
      const goal = String(input?.goal ?? input?.text ?? "");
      if (!goal.trim()) return { ok: false, error: "missing_goal" };
      const architecture = await designArchitecture({ goal, llm });
      return { ok: true, architecture };
    });
    tools.registerTool("meta.design_workflow", async (input: any) => {
      const arch = input?.architecture;
      if (arch && typeof arch === "object") {
        const goal = String((arch as any)?.goal ?? "");
        const archAgents = Array.isArray((arch as any)?.agents) ? (arch as any).agents : [];
        if (!goal.trim() || archAgents.length === 0) return { ok: false, error: "invalid_architecture" };
        return { ok: true, workflow: designWorkflow({ goal, agents: archAgents }) };
      }
      const goal = String(input?.goal ?? input?.text ?? "");
      if (!goal.trim()) return { ok: false, error: "missing_goal_or_architecture" };
      const architecture = await designArchitecture({ goal, llm });
      const workflow = designWorkflow({ goal: architecture.goal, agents: architecture.agents });
      return { ok: true, architecture, workflow };
    });
    tools.registerTool("meta.generate_agents", async (input: any) => {
      const goal = String(input?.goal ?? input?.text ?? "");
      if (!goal.trim()) return { ok: false, error: "missing_goal" };
      const architecture = await designArchitecture({ goal, llm });
      const generation = await generateAgents({
        deps: depsForGenerated as any,
        specs: architecture.agents,
        registerAgent: (agent) => {
          orchestrator.registerAgent(agent);
          workerPool.registerAgent(agent);
        },
      });
      return { ...generation, goal: architecture.goal, rationale: architecture.rationale, architecture };
    });

    tools.registerTool("meta_agent.design", async (input: any) => {
      const goal = String(input?.goal ?? input?.text ?? "");
      const architecture = await designArchitecture({ goal, llm });
      const workflow = designWorkflow({ goal: architecture.goal, agents: architecture.agents });
      return { ok: true, architecture, workflow };
    });
    tools.registerTool("meta_agent.generate_agents", async (input: any) => {
      const goal = String(input?.goal ?? input?.text ?? "");
      if (!goal.trim()) return { ok: false, error: "missing_goal" };
      const architecture = await designArchitecture({ goal, llm });
      const generation = await generateAgents({
        deps: depsForGenerated as any,
        specs: architecture.agents,
        registerAgent: (agent) => {
          orchestrator.registerAgent(agent);
          workerPool.registerAgent(agent);
        },
      });
      return { ...generation, goal: architecture.goal, rationale: architecture.rationale, architecture };
    });
  }
  const shouldRunWorkers =
    !clusterEnabled ||
    clusterRole === "all" ||
    clusterRole === "worker" ||
    String(process.env.IA_ASSISTANT_CLUSTER_RUN_WORKERS ?? "") === "1";
  if (shouldRunWorkers) {
    const research = Number(process.env.IA_ASSISTANT_WORKER_RESEARCH_CONCURRENCY ?? 3);
    const execute = Number(process.env.IA_ASSISTANT_WORKER_EXECUTE_CONCURRENCY ?? 2);
    const analyze = Number(process.env.IA_ASSISTANT_WORKER_ANALYZE_CONCURRENCY ?? 1);
    if (research > 0) workerPool.start(research, ["research"]);
    if (execute > 0) workerPool.start(execute, ["execute"]);
    if (analyze > 0) workerPool.start(analyze, ["analyze"]);
  }

  let clusterHeartbeatTimer: any = null;
  if (clusterEnabled && nodeRegistry) {
    const role =
      clusterRole === "runtime" || clusterRole === "worker" || clusterRole === "simulation"
        ? (clusterRole as any)
        : ("runtime" as any);
    try {
      await nodeRegistry.upsert({
        nodeId: clusterNodeId,
        role,
        types: shouldRunWorkers ? (["research", "execute", "analyze"] as any) : ([] as any),
        capacity: shouldRunWorkers
          ? Object.values(workerPool.getWorkerCounts()).reduce((a, n) => a + Number(n ?? 0), 0)
          : 0,
        busy: shouldRunWorkers ? workerPool.getBusyTotal() : 0,
        meta: { pid: process.pid },
      } as any);
    } catch {}

    const heartbeatMs = Number(process.env.IA_ASSISTANT_CLUSTER_HEARTBEAT_MS ?? 5000);
    clusterHeartbeatTimer = setInterval(() => {
      try {
        const counts = workerPool.getWorkerCounts();
        const cap = Object.values(counts).reduce((a, n) => a + Number(n ?? 0), 0);
        const busy = workerPool.getBusyTotal();
        const types = Object.keys(counts)
          .map((t) => (t === "research" || t === "execute" || t === "analyze" ? (t as any) : null))
          .filter(Boolean) as any;
        void nodeRegistry
          .heartbeat(clusterNodeId, {
            capacity: cap,
            busy,
            types,
          })
          .catch(() => undefined);
        void nodeRegistry
          .reapStale(Number(process.env.IA_ASSISTANT_CLUSTER_STALE_MS ?? 60_000))
          .catch(() => undefined);
      } catch {}
    }, Number.isFinite(heartbeatMs) ? Math.max(1000, heartbeatMs) : 5000);
    if (typeof (clusterHeartbeatTimer as any).unref === "function") (clusterHeartbeatTimer as any).unref();

    tools.registerTool("cluster.nodes.list", async (input: any) => {
      const filterRole = typeof input?.role === "string" ? String(input.role) : undefined;
      const includeStale = Boolean(input?.includeStale);
      const staleMs = Number.isFinite(input?.staleMs) ? Number(input.staleMs) : undefined;
      const nodes = await nodeRegistry.list({
        role:
          filterRole === "runtime" || filterRole === "worker" || filterRole === "simulation"
            ? (filterRole as any)
            : undefined,
        includeStale,
        staleMs,
      });
      return { ok: true, nodeId: clusterNodeId, nodes };
    });
    tools.registerTool("cluster.nodes.reap", async (input: any) => {
      const staleMs = Number.isFinite(input?.staleMs) ? Number(input.staleMs) : 60_000;
      return { ok: true, ...(await nodeRegistry.reapStale(staleMs)) };
    });
  }

  const supervisor = new RuntimeSupervisor(
    {
      tools,
      memory,
      skills,
      graph,
      tracer,
      metrics,
      aiObs,
      firewall: defaultFirewall,
      queue,
      bus,
      learning,
      permissions,
      policy,
      llm,
    },
    workerPool
  );
  supervisor.start();

  const gateway = new CoreGateway({
    orchestrator,
    workflows,
    memory,
    skills,
    tools,
    toolRegistry,
    aiObs,
    graph,
    tracer,
    metrics,
    queue,
    triggers,
    llm,
    bus,
    permissions,
  });

  const marketplaceRepoCandidates = [
    process.env.IA_ASSISTANT_MARKETPLACE_REPO_PATH,
    path.resolve(process.cwd(), "openclaw-repo"),
    path.resolve(process.cwd(), "..", "openclaw-repo"),
  ].filter((p): p is string => Boolean(p && String(p).trim()));
  const marketplaceRepo = marketplaceRepoCandidates.find((p) => fs.existsSync(p));
  if (marketplaceRepo) {
    const manager = new MarketplaceManager({
      repoPath: marketplaceRepo,
      agentDeps: {
        tools,
        memory,
        skills,
        graph,
        tracer,
        metrics,
        aiObs,
        firewall: defaultFirewall,
        queue,
        bus,
        learning,
        permissions,
        policy,
        llm,
      },
      orchestrator,
      workerPool,
      skills,
      tools,
      toolRegistry,
      metrics,
    });

    tools.registerTool("marketplace.list", async () => manager.listAvailable());
    tools.registerTool("marketplace.install", async (input: any) => {
      const kind = String(input?.kind ?? "");
      const name = String(input?.name ?? "");
      if (kind !== "agent" && kind !== "skill" && kind !== "tool") {
        return { ok: false, error: "invalid kind" };
      }
      if (!name.trim()) return { ok: false, error: "missing name" };
      const state = manager.install(kind as any, name);
      const applied = await manager.applyInstalled();
      return { ok: true, state, applied };
    });
    tools.registerTool("marketplace.apply", async () => manager.applyInstalled());
  }

  const autonomy = new AutonomyController(
    {
      tools,
      memory,
      skills,
      graph,
      tracer,
      metrics,
      aiObs,
      firewall: defaultFirewall,
      queue,
      bus,
      learning,
      permissions,
      policy,
      llm,
    },
    workerPool,
    mesh
  );
  const shouldRunRuntimeLoops = shouldRunRuntimeLoopsEarly;
  if (shouldRunRuntimeLoops) autonomy.start();

  const selfImprovementEnabled = process.env.IA_ASSISTANT_SELF_IMPROVEMENT_ENABLE === "1";
  const selfImprovement = selfImprovementEnabled
    ? new AutoRefactorService({
        repoRoot: process.cwd(),
        metrics,
        memory,
        bus,
        llm,
      })
    : null;
  if (shouldRunRuntimeLoops) selfImprovement?.start();
  tools.registerTool("self_improvement.run_once", async (input: any) => {
    if (!selfImprovement) return { ok: false, error: "disabled" };
    const includeMetrics = input?.includeMetrics;
    const includeObserved = input?.includeObserved;
    const maxTasks = typeof input?.maxTasks === "number" ? Number(input.maxTasks) : undefined;
    const apply = typeof input?.apply === "boolean" ? Boolean(input.apply) : undefined;
    const commit = typeof input?.commit === "boolean" ? Boolean(input.commit) : undefined;
    const runTests = typeof input?.runTests === "boolean" ? Boolean(input.runTests) : undefined;
    const sandbox = typeof input?.sandbox === "boolean" ? Boolean(input.sandbox) : undefined;
    const tasks = Array.isArray(input?.tasks) ? input.tasks : undefined;
    return selfImprovement.runOnce({
      mode: "self_improvement",
      includeMetrics: typeof includeMetrics === "boolean" ? includeMetrics : undefined,
      includeObserved: typeof includeObserved === "boolean" ? includeObserved : undefined,
      ...(typeof maxTasks === "number" ? { maxTasks } : {}),
      ...(typeof apply === "boolean" ? { apply } : {}),
      ...(typeof commit === "boolean" ? { commit } : {}),
      ...(typeof runTests === "boolean" ? { runTests } : {}),
      ...(typeof sandbox === "boolean" ? { sandbox } : {}),
      ...(tasks ? { tasks } : {}),
      trigger: { type: "gateway.manual" },
    });
  });
  tools.registerTool("self_improvement.run_loop", async (input: any) => {
    if (!selfImprovement) return { ok: false, error: "disabled" };
    const loop = new SelfImprovementLoop({ service: selfImprovement, episodes });
    return loop.run({
      iterations: typeof input?.iterations === "number" ? Number(input.iterations) : undefined,
      includeMetrics: typeof input?.includeMetrics === "boolean" ? Boolean(input.includeMetrics) : undefined,
      includeObserved: typeof input?.includeObserved === "boolean" ? Boolean(input.includeObserved) : undefined,
      maxTasks: typeof input?.maxTasks === "number" ? Number(input.maxTasks) : undefined,
      apply: typeof input?.apply === "boolean" ? Boolean(input.apply) : undefined,
      commit: typeof input?.commit === "boolean" ? Boolean(input.commit) : undefined,
      runTests: typeof input?.runTests === "boolean" ? Boolean(input.runTests) : undefined,
      sandbox: typeof input?.sandbox === "boolean" ? Boolean(input.sandbox) : undefined,
      stopOnNoTasks: typeof input?.stopOnNoTasks === "boolean" ? Boolean(input.stopOnNoTasks) : undefined,
    });
  });

  const evolver = new EvolverService({
    repoRoot: process.cwd(),
    metrics,
    memory,
    bus,
    llm,
    selfImprovement: selfImprovement ?? undefined,
  });
  if (shouldRunRuntimeLoops) evolver.start();

  const autonomousAgentsEnabled = process.env.IA_ASSISTANT_AUTONOMOUS_AGENTS_ENABLE === "1";
  const autonomousAgents = autonomousAgentsEnabled
    ? new AutonomousAgentManager(
        {
          tools,
          memory,
          skills,
          graph,
          tracer,
          metrics,
          aiObs,
          firewall: defaultFirewall,
          queue,
          bus,
          learning,
          permissions,
          policy,
          llm,
        },
        { workspaceId: "ws:system", repoRoot: process.cwd() }
      )
    : null;
  if (autonomousAgents) {
    autonomousAgents.registerBuiltIns();
    if (shouldRunRuntimeLoops) autonomousAgents.start();
  }

  const triggerSpecs: TriggerSpec[] = [
    {
      trigger_id: "invoice_email",
      event_type: "email.received",
      conditions: [{ field: "payload.subject", operator: "contains", value: "invoice" }],
      workflow: "process_invoice_email",
    },
    {
      trigger_id: "morning_briefing",
      workflow: "morning_briefing",
      schedule: { everyMs: 60_000 },
    },
  ];
  for (const t of triggerSpecs) triggers.register(t);
  if (shouldRunRuntimeLoops) triggers.start();

  return new AIKernel(
    {
      gateway,
      orchestrator,
      workflows,
      memory,
      skills,
      tools,
      graph,
      queue,
      metrics,
      tracer,
      bus,
      llm,
    },
    () => {
      autonomy.stop();
      evolver.stop();
      selfImprovement?.stop();
      autonomousAgents?.stop();
      supervisor.stop();
      try {
        modelRouterOptimizer?.stop();
      } catch {}
      try {
        if (clusterHeartbeatTimer) clearInterval(clusterHeartbeatTimer);
      } catch {}
      try {
        if (swarmReputationTimer) clearInterval(swarmReputationTimer);
      } catch {}
      try {
        void nodeRegistry?.close();
      } catch {}
      workerPool.stop();
      try {
        triggers.stop();
      } catch {}
    }
  );
}
