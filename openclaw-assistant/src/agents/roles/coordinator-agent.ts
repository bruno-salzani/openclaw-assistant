import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";
import { PlannerAgent } from "./planner-agent.js";
import { ResearchAgent } from "./research-agent.js";
import { ExecutorAgent } from "./executor-agent.js";
import { ReviewerAgent } from "./reviewer-agent.js";
import { AnalystAgent } from "./analyst-agent.js";
import { FinanceAgent } from "./finance-agent.js";
import { ReliabilityAgent } from "./reliability-agent.js";
import { createHash, randomUUID } from "node:crypto";
import type { Task } from "../../tasks/task-types.js";
import { buildResponse } from "../response-builder.js";
import { CognitiveCore } from "../cognitive/core.js";
import { CivilizationRuntime } from "../../civilization/runtime.js";
import { OrchestrationPipeline } from "../pipeline/orchestration-pipeline.js";
import { TaskRouter } from "../routing/task-router.js";
import { AgentGraph } from "../graph/agent-graph.js";
import { AgentLifecycle, AgentLifecycleState } from "../runtime/lifecycle.js";
import { PerceptionEngine } from "../../cognition/perception-engine.js";
import { ReasoningEngine } from "../../cognition/reasoning-engine.js";
import { PlanningEngine } from "../../cognition/planning-engine.js";
import { ExecutionEngine } from "../../cognition/execution-engine.js";
import { ReflectionEngine } from "../../cognition/reflection-engine.js";
import { LearningEngine } from "../../cognition/learning-engine.js";
import { KnowledgeState } from "../../world-model/knowledge-state.js";
import { PredictionEngine } from "../../world-model/prediction-engine.js";
import type { CognitivePlan, CognitivePerception, CognitiveReasoning } from "../../cognition/types.js";
import { ImprovementLoop } from "../../cognition/self-reflection/improvement-loop.js";
import { expandHierarchicalSwarm } from "../../cognition/swarm/hierarchical-swarm.js";
import { EpisodeStore } from "../../memory/episodic/episode-store.js";
import { evaluateAnswer } from "../../evaluation/index.js";
import { tryParseJson } from "../../infra/json.js";

export class CoordinatorAgent implements Agent {
  role: Agent["role"] = "coordinator";

  private readonly deps: AgentDeps;

  private readonly planner: PlannerAgent;

  private readonly research: ResearchAgent;

  private readonly executor: ExecutorAgent;

  private readonly reviewer: ReviewerAgent;

  private readonly analyst: AnalystAgent;

  private readonly finance: FinanceAgent;

  private readonly reliability: ReliabilityAgent;

  private readonly cognitive: CognitiveCore;

  private readonly world: KnowledgeState;

  private readonly predictor: PredictionEngine;

  private readonly cogPerception: PerceptionEngine;

  private readonly cogReasoning: ReasoningEngine;

  private readonly cogPlanning: PlanningEngine;

  private readonly cogExecution: ExecutionEngine;

  private readonly cogReflection: ReflectionEngine;

  private readonly cogLearning: LearningEngine;

  private readonly selfReflection: ImprovementLoop;

  private readonly civilization: CivilizationRuntime;

  private readonly dynamicAgents: Agent[] = [];

  private readonly pipeline: OrchestrationPipeline;

  private readonly router: TaskRouter;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.planner = new PlannerAgent(deps);
    this.research = new ResearchAgent(deps);
    this.executor = new ExecutorAgent(deps);
    this.reviewer = new ReviewerAgent(deps);
    this.analyst = new AnalystAgent(deps);
    this.finance = new FinanceAgent(deps);
    this.reliability = new ReliabilityAgent(deps);
    this.cognitive = new CognitiveCore(deps);
    this.world = new KnowledgeState({ memory: deps.memory });
    this.predictor = new PredictionEngine({ llm: deps.llm });
    this.cogPerception = new PerceptionEngine();
    this.cogReasoning = new ReasoningEngine({ llm: deps.llm, world: { state: this.world, predictor: this.predictor } });
    this.cogPlanning = new PlanningEngine();
    this.cogExecution = new ExecutionEngine();
    this.cogReflection = new ReflectionEngine({ llm: deps.llm });
    this.cogLearning = new LearningEngine({ memory: deps.memory, world: this.world });
    this.selfReflection = new ImprovementLoop({ llm: deps.llm, memory: deps.memory });
    this.civilization = new CivilizationRuntime(deps);
    this.pipeline = new OrchestrationPipeline(deps);
    this.router = new TaskRouter(this.civilization);
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("coordinator", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.coordinator", { sessionId: ctx.sessionId });
    try {
      const traceId = String(ctx.metadata?.traceId ?? randomUUID());
      const modality = String((ctx.metadata as any)?.modality ?? "text");
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;

      const cognitionEnabled = process.env.IA_ASSISTANT_COGNITION_ENABLE === "1";
      const swarmEnabled = process.env.IA_ASSISTANT_SWARM_ENABLE === "1";
      let cogPerception: CognitivePerception | null = null;
      let cogReasoning: CognitiveReasoning | null = null;
      let cogPlan: CognitivePlan | null = null;
      let spawnContextText = "";
      let spawnRuns: any[] = [];
      if (cognitionEnabled) {
        try {
          cogPerception = this.cogPerception.perceive({ ctx, text: ctx.text });
          cogReasoning = await this.cogReasoning.reason(cogPerception);
          cogPlan = this.cogPlanning.plan(cogPerception, cogReasoning);
          if (swarmEnabled && cogPlan.spawn.length > 0) {
            cogPlan = expandHierarchicalSwarm(cogPlan);
            const exec = await this.cogExecution.runSpawn({
              ctx,
              plan: cogPlan,
              runAgent: async (role, c) => {
                if (role === "planner") return this.planner.handle(c);
                if (role === "research") return this.research.handle(c);
                if (role === "executor") return this.executor.handle(c);
                if (role === "reviewer") return this.reviewer.handle(c);
                if (role === "analyst") return this.analyst.handle(c);
                if (role === "finance") return this.finance.handle(c);
                if (role === "reliability") return this.reliability.handle(c);
                return this.research.handle(c);
              },
            });
            spawnContextText = exec.contextText;
            spawnRuns = exec.spawnRuns;
          }
        } catch {}
      }

      if (spawnContextText) {
        const prevCtxText =
          typeof (ctx.metadata as any)?.contextText === "string"
            ? String((ctx.metadata as any).contextText)
            : "";
        ctx.metadata = {
          ...(ctx.metadata ?? {}),
          contextText: [prevCtxText, spawnContextText].filter(Boolean).join("\n\n"),
        };
      }

      const perception = await this.cognitive.perceive(ctx.text, modality);
      const rootTaskId = traceId;
      const contextHash = createHash("sha256")
        .update(JSON.stringify({ sessionId: ctx.sessionId, userId: ctx.userId, text: ctx.text }))
        .digest("hex");
      const lifecycle = new AgentLifecycle(
        { memory: this.deps.memory, bus: this.deps.bus },
        { taskId: rootTaskId, agentName: "coordinator", traceId, contextHash }
      );
      await lifecycle.init({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        userRole: ctx.userRole,
        channel: ctx.channel,
      });
      if (typeof (this.deps.graph as any)?.ingestText === "function") {
        (this.deps.graph as any)
          .ingestText(ctx.text, { workspaceId, llm: this.deps.llm, source: "user_message" })
          .catch(() => undefined);
      }

      // 2. Decide strategy
      let finalResponse = "";
      let strategy = perception.strategy;
      let skipReview = false;
      const debug = process.env.IA_ASSISTANT_DEBUG === "1";
      let agentGraphUsed = false;
      let selfReflectionInfo: { iterations: number; lastScore: number } | null = null;

      if (cognitionEnabled && cogPlan) {
        strategy = cogPlan.strategy === "planning" ? "planning" : strategy;
      }

      await lifecycle.plan({ strategy });

      if (perception.newAgent) {
        this.dynamicAgents.push(perception.newAgent);
        const agentResult = await perception.newAgent.handle(ctx);
        finalResponse += `\n[Dynamic Agent]: ${agentResult.text}\n`;
      }

      if (strategy === "planning") {
        const userRole = ctx.userRole ?? "user";
        const useAgentGraph = process.env.IA_ASSISTANT_AGENT_GRAPH === "1";

        if (useAgentGraph) {
          agentGraphUsed = true;
          const g = new AgentGraph({
            nodes: [
              {
                id: "research_primary",
                run: async () => this.research.handle({ ...ctx, text: ctx.text }),
              },
              {
                id: "research_secondary",
                run: async () => this.research.handle({ ...ctx, text: `${ctx.text} constraints` }),
              },
              {
                id: "planner",
                run: async (_ctx, inputs) => {
                  const r1 = inputs.research_primary as any;
                  const r2 = inputs.research_secondary as any;
                  const extra = [
                    r1?.text ? `[Graph Research: primary]\n${String(r1.text)}` : "",
                    r2?.text ? `[Graph Research: secondary]\n${String(r2.text)}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n");
                  const prevCtxText =
                    typeof (ctx.metadata as any)?.contextText === "string"
                      ? String((ctx.metadata as any).contextText)
                      : "";
                  const ctxForPlanning: AgentContext = {
                    ...ctx,
                    metadata: {
                      ...(ctx.metadata ?? {}),
                      contextText: [prevCtxText, extra].filter(Boolean).join("\n\n"),
                    },
                  };

                  let plan = await this.pipeline.plan(ctxForPlanning);
                  if (process.env.OPENCLAW_X_USE_DAG_DEFAULT !== "0") {
                    const { GraphPlannerAgent } = await import("./graph-planner-agent.js");
                    const gp = new GraphPlannerAgent(this.deps);
                    const gpRes = await gp.handle(ctxForPlanning);
                    const parsed = tryParseJson<any>(gpRes.text);
                    if (parsed) plan = parsed;
                  }
                  if (
                    (!plan.tasks || plan.tasks.length === 0) &&
                    (!plan.steps || plan.steps.length === 0)
                  ) {
                    const { GraphPlannerAgent } = await import("./graph-planner-agent.js");
                    const gp = new GraphPlannerAgent(this.deps);
                    const gpRes = await gp.handle(ctxForPlanning);
                    const parsed = tryParseJson<any>(gpRes.text);
                    if (parsed) plan = parsed;
                  }

                  const reasoningEngine = String(process.env.IA_ASSISTANT_REASONING_ENGINE ?? "");
                  if ((reasoningEngine === "tot" || reasoningEngine === "cognitive_tree") && this.deps.llm) {
                    try {
                      const mod = await import("../../reasoning/index.js");
                      const fn =
                        reasoningEngine === "cognitive_tree"
                          ? (mod as any).planWithCognitiveTree
                          : (mod as any).planWithTreeOfThought;
                      const out = await fn({
                        llm: this.deps.llm,
                        objective: ctxForPlanning.text,
                        contextText: String((ctxForPlanning.metadata as any)?.contextText ?? ""),
                        branches: Number(process.env.IA_ASSISTANT_TOT_BRANCHES ?? 3),
                        depth: Number(process.env.IA_ASSISTANT_TOT_DEPTH ?? 2),
                      });
                      plan = out?.plan ?? plan;
                    } catch {}
                  }
                  return { plan, ctxForPlanning };
                },
              },
              {
                id: "execute",
                run: async (_ctx, inputs) => {
                  const plannerOut = inputs.planner as any;
                  const plan = plannerOut?.plan ?? { steps: [] };
                  const ctxForPlanning = (plannerOut?.ctxForPlanning ?? ctx) as AgentContext;

                  const dagSteps =
                    Array.isArray(plan.steps) &&
                    plan.steps.some((s: any) => Array.isArray(s.dependsOn))
                      ? (plan.steps as any[])
                      : null;
                  if (dagSteps) {
                    const { executeDAG } = await import("../pipeline/dag-exec.js");
                    const steps = dagSteps.map((s: any) => ({
                      id: String(s.id),
                      type:
                        s.type === "research" || s.type === "execute" || s.type === "analyze"
                          ? s.type
                          : "research",
                      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
                      payload: s.payload && typeof s.payload === "object" ? s.payload : {},
                      priority:
                        s.priority === "low" || s.priority === "medium" || s.priority === "high"
                          ? s.priority
                          : "medium",
                    }));
                    if (this.deps.bus)
                      this.deps.bus.emit("pipeline.progress", {
                        stage: "dag.dispatch",
                        count: steps.length,
                        traceId,
                      });
                    const dagOut = await executeDAG(this.deps, steps, {
                      sessionId: ctxForPlanning.sessionId,
                      userId: ctxForPlanning.userId,
                      userRole,
                      traceId,
                    });
                    if (this.deps.bus)
                      this.deps.bus.emit("pipeline.results", {
                        traceId,
                        taskResults: dagOut.results,
                      });
                    const researchResults = dagOut.results.filter(
                      (r) => dagOut.index[r.taskId] === "research"
                    );
                    const executionResults = dagOut.results.filter(
                      (r) => dagOut.index[r.taskId] === "execute"
                    );
                    const analysisResult = dagOut.results.find(
                      (r) => dagOut.index[r.taskId] === "analyze"
                    );
                    return {
                      plan,
                      ctxForPlanning,
                      researchResults,
                      executionResults,
                      analysisResult,
                      blocked: [],
                    };
                  }

                  const tasks = this.planToTasks(plan, ctxForPlanning, traceId, userRole);
                  const { blocked, routed } = this.router.route(tasks);
                  const enqueueTasks = routed.filter((t) => t.type !== "analyze");
                  if (this.deps.bus)
                    this.deps.bus.emit("pipeline.progress", {
                      stage: "dispatching",
                      count: enqueueTasks.length,
                      traceId,
                    });
                  const taskResults = await this.pipeline.dispatch(enqueueTasks);
                  if (this.deps.bus)
                    this.deps.bus.emit("pipeline.results", { traceId, taskResults });
                  const researchResults = taskResults.filter((r) => {
                    const t = enqueueTasks.find((x) => x.taskId === r.taskId);
                    return t?.type === "research";
                  });
                  const executionResults = taskResults.filter((r) => {
                    const t = enqueueTasks.find((x) => x.taskId === r.taskId);
                    return t?.type === "execute";
                  });

                  const analysisTask = this.makeTask({
                    traceId,
                    sessionId: ctxForPlanning.sessionId,
                    userId: ctxForPlanning.userId,
                    userRole,
                    type: "analyze",
                    priority: "medium",
                    payload: { inputs: taskResults.map((r) => r.output) },
                  });
                  const a = this.civilization.assign(analysisTask);
                  if (a.decision.allow) {
                    if (a.bid?.agentType) analysisTask.agentType = a.bid.agentType;
                    analysisTask.payload = {
                      ...analysisTask.payload,
                      civ: a.bid?.civilization,
                      priceCredits: a.bid?.priceCredits,
                      bidConfidence: a.bid?.confidence,
                      bidReason: a.bid?.reason,
                    };
                    await this.deps.queue.enqueue(analysisTask);
                    this.deps.metrics.counter("task_created_total").inc();
                    const analysisResult = await this.deps.queue.waitForResult(analysisTask.taskId);
                    return {
                      plan,
                      ctxForPlanning,
                      researchResults,
                      executionResults,
                      analysisResult,
                      blocked,
                    };
                  }
                  return {
                    plan,
                    ctxForPlanning,
                    researchResults,
                    executionResults,
                    analysisResult: null,
                    blocked,
                    analysisBlocked: a.decision,
                  };
                },
              },
              {
                id: "compose",
                run: async (_ctx, inputs) => {
                  const execOut = inputs.execute as any;
                  const planText = JSON.stringify(execOut?.plan ?? {});
                  const blocked = Array.isArray(execOut?.blocked) ? execOut.blocked : [];
                  const analysisBlocked = execOut?.analysisBlocked;
                  let text = "";
                  if (blocked.length > 0) {
                    text += `Governança bloqueou ${blocked.length} tarefa(s): ${JSON.stringify(blocked)}`;
                  }
                  if (analysisBlocked) {
                    text += `Governança bloqueou análise: ${JSON.stringify(analysisBlocked)}`;
                  }
                  text += buildResponse({
                    planText,
                    research: execOut?.researchResults ?? [],
                    execution: execOut?.executionResults ?? [],
                    analysis: execOut?.analysisResult ?? undefined,
                  });
                  return { finalResponse: text };
                },
              },
              {
                id: "review",
                run: async (_ctx, inputs) => {
                  const composed = inputs.compose as any;
                  const review = await this.reviewer.handle({
                    ...ctx,
                    text: String(composed?.finalResponse ?? ""),
                  });
                  return tryParseJson<Record<string, unknown>>(review.text) ?? { status: "ok" };
                },
              },
              {
                id: "final",
                run: async (_ctx, inputs) => {
                  const composed = inputs.compose as any;
                  const reviewJson = inputs.review as any;
                  if (reviewJson?.status === "blocked") {
                    return {
                      blocked: true,
                      finalResponse: `🚫 **Blocked by Policy**:\n${JSON.stringify(reviewJson.issues)}`,
                    };
                  }
                  return { blocked: false, finalResponse: String(composed?.finalResponse ?? "") };
                },
              },
            ],
            edges: [
              { from: "research_primary", to: "planner" },
              { from: "research_secondary", to: "planner" },
              { from: "planner", to: "execute" },
              { from: "execute", to: "compose" },
              { from: "compose", to: "review" },
              { from: "compose", to: "final" },
              { from: "review", to: "final" },
            ],
          });

          const out = await g.execute(ctx);
          const fin = out.resultsByNodeId.final as any;
          finalResponse += String(fin?.finalResponse ?? "");
          skipReview = true;
          if (fin?.blocked) {
            await lifecycle.error({ reason: "policy_blocked" });
            return { text: String(fin.finalResponse), meta: { blocked: true } };
          }
        }

        if (!useAgentGraph) {
          const ctxForPlanning = ctx;
          let plan = await this.pipeline.plan(ctxForPlanning);
          if (process.env.OPENCLAW_X_USE_DAG_DEFAULT !== "0") {
            const { GraphPlannerAgent } = await import("./graph-planner-agent.js");
            const gp = new GraphPlannerAgent(this.deps);
            const gpRes = await gp.handle(ctxForPlanning);
            const parsed = tryParseJson<any>(gpRes.text);
            if (parsed) plan = parsed;
          }
          if (
            (!plan.tasks || plan.tasks.length === 0) &&
            (!plan.steps || plan.steps.length === 0)
          ) {
            const { GraphPlannerAgent } = await import("./graph-planner-agent.js");
            const gp = new GraphPlannerAgent(this.deps);
            const gpRes = await gp.handle(ctxForPlanning);
            const parsed = tryParseJson<any>(gpRes.text);
            if (parsed) plan = parsed;
          }

          const reasoningEngine = String(process.env.IA_ASSISTANT_REASONING_ENGINE ?? "");
          if ((reasoningEngine === "tot" || reasoningEngine === "cognitive_tree") && this.deps.llm) {
            try {
              const mod = await import("../../reasoning/index.js");
              const fn =
                reasoningEngine === "cognitive_tree" ? (mod as any).planWithCognitiveTree : (mod as any).planWithTreeOfThought;
              const out = await fn({
                llm: this.deps.llm,
                objective: ctxForPlanning.text,
                contextText: String((ctxForPlanning.metadata as any)?.contextText ?? ""),
                branches: Number(process.env.IA_ASSISTANT_TOT_BRANCHES ?? 3),
                depth: Number(process.env.IA_ASSISTANT_TOT_DEPTH ?? 2),
              });
              plan = out?.plan ?? plan;
            } catch {}
          }
          await this.deps.memory.saveAgentState({
            taskId: rootTaskId,
            agentName: "coordinator",
            step: AgentLifecycleState.PLAN,
            progress: 0.2,
            status: "running",
            context: { strategy: "planning", hasSteps: Array.isArray((plan as any)?.steps) },
            memoryRefs: [],
            contextHash,
          });

          const dagSteps =
            Array.isArray(plan.steps) && plan.steps.some((s: any) => Array.isArray(s.dependsOn))
              ? (plan.steps as any[])
              : null;
          await lifecycle.execute({ mode: dagSteps ? "dag" : "queue" });
          if (dagSteps) {
            const { executeDAG } = await import("../pipeline/dag-exec.js");
            const steps = dagSteps.map((s: any) => ({
              id: String(s.id),
              type:
                s.type === "research" || s.type === "execute" || s.type === "analyze"
                  ? s.type
                  : "research",
              dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
              payload: s.payload && typeof s.payload === "object" ? s.payload : {},
              priority:
                s.priority === "low" || s.priority === "medium" || s.priority === "high"
                  ? s.priority
                  : "medium",
            }));
            if (this.deps.bus)
              this.deps.bus.emit("pipeline.progress", {
                stage: "dag.dispatch",
                count: steps.length,
                traceId,
              });
            const dagOut = await executeDAG(this.deps, steps, {
              sessionId: ctxForPlanning.sessionId,
              userId: ctxForPlanning.userId,
              userRole,
              traceId,
            });
            if (this.deps.bus)
              this.deps.bus.emit("pipeline.results", { traceId, taskResults: dagOut.results });
            const researchResults = dagOut.results.filter(
              (r) => dagOut.index[r.taskId] === "research"
            );
            const executionResults = dagOut.results.filter(
              (r) => dagOut.index[r.taskId] === "execute"
            );
            const analysisResult = dagOut.results.find((r) => dagOut.index[r.taskId] === "analyze");
            await lifecycle.enter({
              state: AgentLifecycleState.EXECUTE,
              status: "running",
              progress: 0.85,
              context: {
                mode: "dag",
                research: researchResults.length,
                execution: executionResults.length,
                analysis: Boolean(analysisResult),
              },
            });
            finalResponse += buildResponse({
              planText: JSON.stringify(plan),
              research: researchResults,
              execution: executionResults,
              analysis: analysisResult,
            });
          } else {
            const tasks = this.planToTasks(plan, ctxForPlanning, traceId, userRole);
            const { blocked, routed } = this.router.route(tasks);

            if (blocked.length > 0) {
              finalResponse += `Governança bloqueou ${blocked.length} tarefa(s): ${JSON.stringify(blocked)}`;
            }

            const enqueueTasks = routed.filter((t) => t.type !== "analyze");
            if (this.deps.bus)
              this.deps.bus.emit("pipeline.progress", {
                stage: "dispatching",
                count: enqueueTasks.length,
                traceId,
              });
            const taskResults = await this.pipeline.dispatch(enqueueTasks);
            if (this.deps.bus) this.deps.bus.emit("pipeline.results", { traceId, taskResults });
            const researchResults = taskResults.filter((r) => {
              const t = enqueueTasks.find((x) => x.taskId === r.taskId);
              return t?.type === "research";
            });
            const executionResults = taskResults.filter((r) => {
              const t = enqueueTasks.find((x) => x.taskId === r.taskId);
              return t?.type === "execute";
            });

            const analysisTask = this.makeTask({
              traceId,
              sessionId: ctxForPlanning.sessionId,
              userId: ctxForPlanning.userId,
              userRole,
              type: "analyze",
              priority: "medium",
              payload: { inputs: taskResults.map((r) => r.output) },
            });
            const a = this.civilization.assign(analysisTask);
            if (a.decision.allow) {
              if (a.bid?.agentType) analysisTask.agentType = a.bid.agentType;
              analysisTask.payload = {
                ...analysisTask.payload,
                civ: a.bid?.civilization,
                priceCredits: a.bid?.priceCredits,
                bidConfidence: a.bid?.confidence,
                bidReason: a.bid?.reason,
              };
              await this.deps.queue.enqueue(analysisTask);
              this.deps.metrics.counter("task_created_total").inc();
              const analysisResult = await this.deps.queue.waitForResult(analysisTask.taskId);
              await lifecycle.enter({
                state: AgentLifecycleState.EXECUTE,
                status: "running",
                progress: 0.9,
                context: {
                  mode: "queue",
                  research: researchResults.length,
                  execution: executionResults.length,
                  analysis: true,
                },
              });
              finalResponse += buildResponse({
                planText: JSON.stringify(plan),
                research: researchResults,
                execution: executionResults,
                analysis: analysisResult,
              });
            } else {
              await lifecycle.enter({
                state: AgentLifecycleState.EXECUTE,
                status: "running",
                progress: 0.9,
                context: { mode: "queue", analysisBlocked: a.decision },
              });
              finalResponse += `Governança bloqueou análise: ${JSON.stringify(a.decision)}`;
              finalResponse += buildResponse({
                planText: JSON.stringify(plan),
                research: researchResults,
                execution: executionResults,
              });
            }
          }
        }
      } else if (strategy === "direct_execution") {
        await lifecycle.execute({ mode: "direct_execution", intent: perception.intent?.type ?? null });
        // Map intent entities to tool calls
        const intent = perception.intent;
        if (intent.type === "app_control") {
          const app = intent.entities.app as string;
          const action = intent.entities.action as string;
          const tool = action === "launch" ? "apps.launch" : "apps.close";
          const env = String((perception.context?.environment as any)?.target_env ?? "local");
          const guard = this.deps.policy
            ? this.deps.policy.evaluateTool(
                tool,
                { app, env },
                {
                  userRole: ctx.userRole ?? "user",
                  approved: Boolean((ctx.metadata as any)?.human_confirmed),
                  traceId,
                  source: "coordinator.direct",
                }
              )
            : { requireConfirmation: false, allowed: true, risk: "low" as const };
          if (guard.requireConfirmation && !(ctx.metadata as any)?.human_confirmed) {
            finalResponse = `Ação sensível detectada (${tool}). Confirme para continuar.`;
          } else {
            const perms =
              this.deps.permissions?.getPermissions("executor_agent", workspaceId) ?? [];
            const res = await this.deps.tools.execute(
              tool,
              { app, env },
              {
                userRole: ctx.userRole,
                permissions: perms,
                traceId,
                rate: { perMin: 30 },
                cacheTtlMs: 10_000,
                approved: Boolean((ctx.metadata as any)?.human_confirmed),
                workspaceId,
              }
            );
            finalResponse = JSON.stringify(res);
          }
        } else if (intent.type === "iot_control") {
          const device = intent.entities.device as string;
          const state = intent.entities.state as string;
          const env = String((perception.context?.environment as any)?.target_env ?? "iot");
          const guard = this.deps.policy
            ? this.deps.policy.evaluateTool(
                "iot.set_light",
                { device, state, env },
                {
                  userRole: ctx.userRole ?? "user",
                  approved: Boolean((ctx.metadata as any)?.human_confirmed),
                  traceId,
                  source: "coordinator.direct",
                }
              )
            : { requireConfirmation: false, allowed: true, risk: "low" as const };
          if (guard.requireConfirmation && !(ctx.metadata as any)?.human_confirmed) {
            finalResponse = `Ação sensível detectada (iot.set_light). Confirme para continuar.`;
          } else {
            const perms =
              this.deps.permissions?.getPermissions("executor_agent", workspaceId) ?? [];
            const res = await this.deps.tools.execute(
              "iot.set_light",
              { device, state, env },
              {
                userRole: ctx.userRole,
                permissions: perms,
                traceId,
                rate: { perMin: 60 },
                approved: Boolean((ctx.metadata as any)?.human_confirmed),
                workspaceId,
              }
            );
            finalResponse = JSON.stringify(res);
          }
        } else {
          const exec = await this.executor.handle(ctx);
          finalResponse += exec.text;
        }
      } else {
        await lifecycle.execute({ mode: "research_only" });
        const res = await this.research.handle(ctx);
        finalResponse += res.text;
      }

      if (!skipReview) {
        await lifecycle.review();
        const reasoningEngine = String(process.env.IA_ASSISTANT_REASONING_ENGINE ?? "");
        if (reasoningEngine === "reflexion" && this.deps.llm) {
          try {
            const { reflexionReviseAnswer } = await import("../../reasoning/index.js");
            const revised = await reflexionReviseAnswer({
              llm: this.deps.llm,
              prompt: ctx.text,
              answer: finalResponse,
            });
            finalResponse = revised.revised;
          } catch {}
        }
        if (reasoningEngine === "debate") {
          try {
            const proposals: Array<{ id: string; text: string }> = [{ id: "p1", text: finalResponse }];
            if (this.deps.llm && process.env.IA_ASSISTANT_REASONING_DEBATE_LLM === "1") {
              const out = await this.deps.llm.chat({
                messages: [
                  {
                    role: "system",
                    content: [
                      "Gere variações alternativas da resposta para o usuário.",
                      "Responda APENAS JSON válido, sem markdown.",
                      'Formato: { "answers": string[] }',
                      "Gere 2 respostas alternativas. Sem inventar fatos. Mantenha a mesma intenção.",
                    ].join("\n"),
                  },
                  { role: "user", content: JSON.stringify({ prompt: ctx.text, answer: finalResponse }) },
                ],
                temperature: 0.3,
                maxTokens: 600,
              });
              const parsed = tryParseJson<{ answers?: unknown }>(out);
              const answers = Array.isArray(parsed?.answers) ? (parsed.answers as any[]).map(String) : [];
              for (let i = 0; i < Math.min(2, answers.length); i++) {
                const a = String(answers[i] ?? "").trim();
                if (a) proposals.push({ id: `p${i + 2}`, text: a });
              }
            }
            let debate: any;
            if (process.env.IA_ASSISTANT_EMERGENT_SWARM_ENABLE === "1") {
              const extras: Array<{ id: string; agent: string; text: string }> = [
                { id: "p_coordinator", agent: "coordinator", text: finalResponse },
              ];
              const makePrompt = (role: string) =>
                [
                  `Você é o agente ${role}.`,
                  "Proponha a melhor resposta final para o usuário com base no prompt e na resposta atual.",
                  "Seja direto e não invente fatos.",
                  "",
                  `Prompt: ${ctx.text}`,
                  `Resposta atual: ${finalResponse}`,
                ].join("\n");
              const jobs: Array<Promise<void>> = [];
              jobs.push(
                this.research
                  .handle({ ...ctx, text: makePrompt("research") })
                  .then((r) => {
                    extras.push({ id: "p_research", agent: "research", text: r.text });
                  })
                  .catch(() => undefined)
              );
              jobs.push(
                this.analyst
                  .handle({ ...ctx, text: makePrompt("analyst") })
                  .then((r) => {
                    extras.push({ id: "p_analyst", agent: "analyst", text: r.text });
                  })
                  .catch(() => undefined)
              );
              jobs.push(
                this.reliability
                  .handle({ ...ctx, text: makePrompt("reliability") })
                  .then((r) => {
                    extras.push({ id: "p_reliability", agent: "reliability", text: r.text });
                  })
                  .catch(() => undefined)
              );
              jobs.push(
                this.finance
                  .handle({ ...ctx, text: makePrompt("finance") })
                  .then((r) => {
                    extras.push({ id: "p_finance", agent: "finance", text: r.text });
                  })
                  .catch(() => undefined)
              );
              await Promise.all(jobs);

              const { ReputationSystem, SwarmCoordinator } = await import("../../swarm/index.js");
              const rep = new ReputationSystem(process.cwd());
              rep.load();
              const coordinator = new SwarmCoordinator({
                llm: this.deps.llm,
                memory: this.deps.memory,
                reputation: rep,
              });
              const swarmProposals = extras
                .filter((p) => String(p.text ?? "").trim())
                .slice(0, 8);
              const out = await coordinator.debate({ task: ctx.text, proposals: swarmProposals });
              debate = out.debate;
              finalResponse = out.consensus.winner.text;
              try {
                this.deps.bus?.emit("swarm.consensus", {
                  sessionId: ctx.sessionId,
                  traceId,
                  winnerId: out.consensus.winner.id,
                  ranking: out.consensus.ranking,
                });
              } catch {}
            } else {
              const { runDebate } = await import("../../reasoning/index.js");
              const { ReasoningMemory } = await import("../../reasoning/reasoning-memory.js");
              debate = await runDebate({
                task: ctx.text,
                llm: this.deps.llm,
                proposals,
                memory: new ReasoningMemory(this.deps.memory),
              });
              finalResponse = debate.winner.text;
            }
            try {
              this.deps.bus?.emit("reasoning.debate", {
                sessionId: ctx.sessionId,
                traceId,
                winnerId: debate.winner.id,
                proposals: debate.proposals.map((p: any) => ({ id: p.id })),
                scores: debate.ranking.map((s: any) => ({ proposalId: s.proposalId, score: s.score })),
              });
            } catch {}
          } catch {}
        }
        if (cognitionEnabled) {
          try {
            const reflected = await this.cogReflection.reflect({ prompt: ctx.text, answer: finalResponse });
            if (reflected.revised && reflected.revised.trim()) finalResponse = reflected.revised;
          } catch {}
        }
        if (process.env.IA_ASSISTANT_SELF_REFLECTION_ENABLE === "1") {
          try {
            const loop = await this.selfReflection.run({
              prompt: ctx.text,
              answer: finalResponse,
              traceId,
              sessionId: ctx.sessionId,
              userId: ctx.userId,
            });
            selfReflectionInfo = { iterations: loop.iterations, lastScore: loop.lastScore };
            finalResponse = loop.final;
          } catch {}
        }
        const review = await this.reviewer.handle({ ...ctx, text: finalResponse });
        const reviewJson = tryParseJson<{ status?: unknown; issues?: unknown }>(review.text);
        if (reviewJson?.status === "blocked") {
          const issues = Array.isArray(reviewJson.issues) ? reviewJson.issues : [];
          await lifecycle.error({ issues });
          return {
            text: `🚫 **Blocked by Policy**:\n${JSON.stringify(issues)}`,
            meta: { blocked: true, issues },
          };
        }
      }

      const translated = this.cognitive.translateOut(finalResponse);
      let finalText = translated;
      let evaluation: any = null;
      if (this.deps.llm && process.env.IA_ASSISTANT_LLM_COORDINATOR === "1") {
        try {
          const assembledContext =
            typeof (ctx.metadata as any)?.contextText === "string"
              ? String((ctx.metadata as any).contextText)
              : "";
          const history = Array.isArray((ctx as any).history)
            ? ((ctx as any).history as any[])
            : [];
          const system =
            modality === "voice"
              ? [
                  "Você é o IA Assistant.",
                  "Responda em português do Brasil.",
                  "Seja curto e direto (apropriado para voz).",
                  "Não mencione planejamento interno, tasks, fila, agentes ou governança.",
                ].join("\n")
              : [
                  "Você é o IA Assistant.",
                  "Responda em português do Brasil.",
                  "Entregue a melhor resposta final possível para o usuário.",
                  "Não mencione planejamento interno, tasks, fila, agentes ou governança, a menos que o usuário peça explicitamente.",
                  "Quando houver ambiguidade, faça suposições razoáveis e deixe claro o que foi assumido.",
                ].join("\n");
          const out = await this.deps.llm.chat({
            messages: [
              { role: "system", content: system },
              ...(assembledContext ? [{ role: "system", content: assembledContext }] : []),
              ...history.map((m: any) => ({
                role: m?.role === "assistant" ? "assistant" : "user",
                content: String(m?.content ?? ""),
              })),
              {
                role: "user",
                content: [
                  `Pedido do usuário:\n${ctx.text}`,
                  "",
                  "Resposta preliminar (refine para virar a resposta final):",
                  translated,
                ].join("\n"),
              },
            ],
            temperature: modality === "voice" ? 0.2 : 0.4,
            maxTokens: modality === "voice" ? 280 : 900,
          });
          if (out && out.trim()) finalText = out.trim();
        } catch {}
      }
      if (typeof (this.deps.graph as any)?.ingestText === "function") {
        (this.deps.graph as any)
          .ingestText(finalText, { workspaceId, llm: this.deps.llm, source: "assistant_message" })
          .catch(() => undefined);
      }
      try {
        evaluation = await evaluateAnswer({
          llm: this.deps.llm,
          prompt: ctx.text,
          answer: finalText,
          contextText: typeof (ctx.metadata as any)?.contextText === "string" ? String((ctx.metadata as any).contextText) : undefined,
        });
        await this.deps.memory.add("meta", JSON.stringify(evaluation), {
          type: "evaluation",
          traceId,
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          workspaceId,
          ts: Date.now(),
        });
      } catch {}
      if (cognitionEnabled && cogPerception && cogPlan) {
        try {
          await this.cogLearning.record({
            ts: Date.now(),
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            objective: cogPerception.objective,
            perception: cogPerception,
            plan: cogPlan,
            spawnRuns: Array.isArray(spawnRuns)
              ? spawnRuns.map((r: any) => ({ id: String(r.id), role: r.role, ok: Boolean(r.ok) }))
              : [],
            outputHash: this.cogReflection.hashOutput(finalText),
          });
        } catch {}
      }
      // Record interaction for continual learning (non-blocking)
      this.deps.learning
        ?.recordInteraction("coordinator", ctx.text, finalText, true)
        .catch(() => undefined);
      try {
        const episodes = new EpisodeStore({ memory: this.deps.memory });
        void episodes
          .record({
            id: traceId,
            kind: "interaction_detailed",
            objective: ctx.text,
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            workspaceId,
            ok: true,
            score: typeof selfReflectionInfo?.lastScore === "number" ? selfReflectionInfo.lastScore : 1,
            tags: [strategy],
            result: {
              strategy,
              agentGraphUsed,
              skipReview,
              selfReflection: selfReflectionInfo,
              cognitionEnabled,
              evaluation,
              answer: finalText,
            },
          })
          .catch(() => undefined);
      } catch {}
      await lifecycle.finalize({ answerLen: finalText.length, strategy });
      return {
        text: finalText,
        meta: {
          processedBy: "coordinator",
          steps: strategy,
          intent: perception.intent,
          ...(debug
            ? {
                debug: {
                  agentGraphUsed,
                  skipReview,
                  finalResponseLen: finalResponse.length,
                },
              }
            : {}),
          ui:
            modality === "voice"
              ? { type: "voice_response", text: finalText }
              : { type: "chat_response", text: finalText },
        },
      };
    } finally {
      span.end();
    }
  }

  private planToTasks(
    plan: {
      tasks?: Array<{ type: string; priority?: string; payload?: Record<string, unknown> }>;
      steps?: any[];
    },
    ctx: AgentContext,
    traceId: string,
    userRole: "user" | "admin" | "service"
  ): Task[] {
    const tasks: Task[] = [];
    const declared = Array.isArray(plan.tasks) ? plan.tasks : [];
    if (declared.length > 0) {
      for (const t of declared) {
        const type =
          t.type === "research" || t.type === "execute" || t.type === "analyze"
            ? t.type
            : "research";
        const priority =
          t.priority === "high" || t.priority === "medium" || t.priority === "low"
            ? t.priority
            : "medium";
        tasks.push(
          this.makeTask({
            traceId,
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            userRole,
            type,
            priority,
            payload: t.payload ?? { query: ctx.text },
          })
        );
      }
      return tasks;
    }

    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    for (const s of steps) {
      if (s.type === "research") {
        tasks.push(
          this.makeTask({
            traceId,
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            userRole,
            type: "research",
            priority: "high",
            payload: { query: String(s.query ?? ctx.text) },
          })
        );
      } else if (s.type === "execution") {
        const action = String(s.action ?? "");
        const parts = action.split(" ");
        const toolName = parts[0] ?? "";
        const args = parts.slice(1).join(" ");
        tasks.push(
          this.makeTask({
            traceId,
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            userRole,
            type: "execute",
            priority: "medium",
            payload: { toolName, args },
          })
        );
      }
    }
    if (tasks.length === 0) {
      tasks.push(
        this.makeTask({
          traceId,
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          userRole,
          type: "research",
          priority: "high",
          payload: { query: ctx.text },
        })
      );
    }
    return tasks;
  }

  private makeTask(input: Omit<Task, "taskId" | "status" | "createdAt" | "updatedAt">): Task {
    const t = Date.now();
    return {
      ...input,
      taskId: randomUUID(),
      status: "pending",
      createdAt: t,
      updatedAt: t,
    };
  }
}
