import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";
import { decomposeGoal } from "../../planning/goal-decomposer.js";
import { generatePlan } from "../../planning/plan-generator.js";
import { validatePlan } from "../../planning/plan-validator.js";
import { planGoap } from "../../planning/goap.js";
import { planHtn } from "../../planning/htn.js";

export class PlannerAgent implements Agent {
  role: Agent["role"] = "planner";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("planner", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.planner", { sessionId: ctx.sessionId });
    try {
      this.deps.metrics.counter("planning_runs_total").inc();
      const taskId =
        typeof (ctx.metadata as any)?.taskId === "string"
          ? String((ctx.metadata as any).taskId)
          : undefined;
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "planner",
            step: "start",
            progress: 0,
            status: "running",
            context: { objective: ctx.text },
            memoryRefs: [],
          });
        } catch {}
      }

      // OODA Loop: Observe (Context) -> Orient (Memory/Knowledge) -> Decide (Plan) -> Act (Tasks)

      // Orient: Retrieve relevant long-term memory or rules
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      const traceId =
        typeof (ctx.metadata as any)?.traceId === "string"
          ? String((ctx.metadata as any).traceId)
          : undefined;
      const context = await this.deps.memory.search(ctx.text, {
        limit: 3,
        workspaceId,
        userId: ctx.userId,
      });
      const contextStr = context.map((m) => m.content).join("\n");
      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "planner",
            step: "context_ready",
            progress: 0.35,
            status: "running",
            context: { hits: context.length },
            memoryRefs: context.map((m) => m.id).filter(Boolean),
          });
        } catch {}
      }
      const assembledContext =
        typeof (ctx.metadata as any)?.contextText === "string"
          ? String((ctx.metadata as any).contextText)
          : "";

      // Check if there is a goal context injected from Cognitive Core
      const goalContext = (ctx.metadata as any)?.goal;

      // Decide: Decompose based on Goal if available
      const tasks = [];

      const plannerEngineRaw = String(process.env.IA_ASSISTANT_PLANNER_ENGINE ?? "").trim().toLowerCase();
      const plannerEngine =
        plannerEngineRaw === "goap" || plannerEngineRaw === "htn" || plannerEngineRaw === "llm"
          ? plannerEngineRaw
          : null;

      const llmEnabled = Boolean(this.deps.llm) && process.env.IA_ASSISTANT_LLM_PLANNER === "1";
      const planningEngineEnabled = process.env.IA_ASSISTANT_PLANNING_ENGINE === "1";
      if (plannerEngine === "llm" && llmEnabled) {
        try {
          let toolHints = "";
          if (process.env.IA_ASSISTANT_TOOL_INTELLIGENCE_ENABLE === "1" && this.deps.permissions) {
            try {
              const perms = this.deps.permissions.getPermissions("planner_agent", workspaceId);
              const rec = await this.deps.tools.execute(
                "tool_intelligence.recommend",
                { query: "search", limit: 5 },
                {
                  userRole: ctx.userRole ?? "user",
                  permissions: perms,
                  workspaceId,
                  traceId,
                  source: "agent.planner",
                }
              );
              toolHints = JSON.stringify(rec);
            } catch {}
          }
          const system = [
            "Você é um planejador de tasks para um sistema multi-agente.",
            "Gere APENAS um JSON válido, sem markdown, sem texto extra.",
            "Formato obrigatório:",
            "{",
            '  "objective": string,',
            '  "context": string,',
            '  "tasks": Array<{ "type": "research" | "execute" | "analyze", "priority": "low" | "medium" | "high", "payload": Record<string, any> }>',
            "}",
            "Regras:",
            "- No máximo 6 tasks.",
            "- Prefira research quando faltar dados.",
            "- Use analyze para consolidar outputs de research/execute.",
            toolHints ? `Tool intelligence (use para escolher ferramentas melhores quando aplicável): ${toolHints}` : "",
          ].join("\n");
          const user = [
            `Objective: ${ctx.text}`,
            assembledContext
              ? `Context:\n${assembledContext}`
              : contextStr
                ? `Context:\n${contextStr}`
                : "",
            goalContext ? `Goal:\n${JSON.stringify(goalContext)}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");

          const history = Array.isArray((ctx as any).history)
            ? ((ctx as any).history as any[])
            : [];
          const historyMessages = history
            .map((m: any) => ({
              role:
                m?.role === "assistant" ? "assistant" : m?.role === "system" ? "system" : "user",
              content: String(m?.content ?? ""),
            }))
            .filter((m: any) => Boolean(m.content && String(m.content).trim()))
            .slice(-20);

          const out = await this.deps.llm!.chat({
            messages: [
              { role: "system", content: system },
              ...historyMessages,
              { role: "user", content: user },
            ],
            temperature: 0.2,
            maxTokens: 900,
          });

          const parsed = JSON.parse(out) as any;
          if (parsed && typeof parsed === "object") {
            const objective = typeof parsed.objective === "string" ? parsed.objective : ctx.text;
            const contextOut = typeof parsed.context === "string" ? parsed.context : contextStr;
            const tasksOut = Array.isArray(parsed.tasks) ? parsed.tasks : [];
            if (taskId) {
              try {
                await this.deps.memory.saveAgentState({
                  taskId,
                  agentName: "planner",
                  step: "planned",
                  progress: 0.8,
                  status: "running",
                  context: { objective, tasks: tasksOut.length, planId: "llm-plan" },
                  memoryRefs: [],
                });
              } catch {}
            }
            return {
              text: JSON.stringify({
                objective,
                context: contextOut,
                goalId: goalContext?.id,
                tasks: tasksOut,
              }),
              meta: { planId: "llm-plan" },
            };
          }
        } catch {}
      }

      const useGoap = plannerEngine === "goap";
      const useHtn = plannerEngine === "htn";
      if (useGoap) {
        const plan = planGoap({ objective: ctx.text, contextText: [assembledContext, contextStr].filter(Boolean).join("\n\n") });
        if (plan.ok && plan.steps.length > 0) {
          const steps = plan.steps.map((s) => ({
            id: s.id,
            type: s.type,
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
            payload: s.payload ?? {},
            priority: s.priority ?? (s.type === "execute" ? "high" : "medium"),
          }));
          for (const s of steps) {
            tasks.push({
              type: s.type,
              priority: s.priority,
              payload: s.payload,
            });
          }
          return {
            text: JSON.stringify({
              objective: ctx.text,
              context: contextStr,
              goalId: goalContext?.id,
              plannerEngine: "goap",
              steps,
              tasks,
              actions: plan.actions,
            }),
            meta: { planId: "goap-plan" },
          };
        }
      }
      if (useHtn) {
        const plan = planHtn({ objective: ctx.text });
        if (plan.ok && plan.steps.length > 0) {
          const steps = plan.steps.map((s) => ({
            id: s.id,
            type: s.type,
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
            payload: s.payload ?? {},
            priority: s.priority ?? (s.type === "execute" ? "high" : "medium"),
          }));
          for (const s of steps) {
            tasks.push({
              type: s.type,
              priority: s.priority,
              payload: s.payload,
            });
          }
          if (!tasks.some((t: any) => t.type === "analyze")) {
            tasks.push({ type: "analyze", priority: "medium", payload: { context: "htn" } });
          }
          return {
            text: JSON.stringify({
              objective: ctx.text,
              context: contextStr,
              goalId: goalContext?.id,
              plannerEngine: "htn",
              steps,
              tasks,
            }),
            meta: { planId: "htn-plan" },
          };
        }
      }

      if ((planningEngineEnabled || !plannerEngine) && !goalContext) {
        try {
          const decomp = decomposeGoal(ctx.text);
          const plan = generatePlan(decomp);
          const v = validatePlan(plan);
          if (v.ok && plan.steps.length > 0) {
            for (const s of plan.steps) {
              tasks.push({
                type: s.type,
                priority: s.priority ?? (s.type === "execute" ? "high" : "medium"),
                payload: s.payload ?? { query: s.id },
              });
            }
            if (!tasks.some((t: any) => t.type === "analyze")) {
              tasks.push({ type: "analyze", priority: "medium", payload: { context: "planning_engine" } });
            }
          }
        } catch {}
      }

      if (tasks.length === 0) {
        if (goalContext && goalContext.subtasks) {
          for (const sub of goalContext.subtasks) {
            if (sub === "organize_schedule") {
              tasks.push({
                type: "execute",
                priority: "high",
                payload: { toolName: "calendar.list", args: "next week" },
              });
            } else if (sub === "search_flights") {
              tasks.push({
                type: "research",
                priority: "high",
                payload: { query: "flights prices" },
              });
            } else {
              tasks.push({ type: "research", priority: "medium", payload: { query: sub } });
            }
          }
          tasks.push({ type: "analyze", priority: "medium", payload: { context: goalContext.type } });
        } else if (ctx.text.includes("invoice") || ctx.text.includes("finance")) {
          tasks.push({
            type: "execute",
            priority: "high",
            payload: { toolName: "postgres.query", args: "SELECT * FROM invoices LIMIT 5" },
          });
          tasks.push({ type: "analyze", priority: "medium", payload: { context: "finance" } });
        } else {
          tasks.push({
            type: "research",
            priority: "high",
            payload: { query: `${ctx.text} competitors` },
          });
          tasks.push({
            type: "research",
            priority: "high",
            payload: { query: `${ctx.text} pricing` },
          });
          tasks.push({
            type: "analyze",
            priority: "medium",
            payload: { method: "competitive-analysis" },
          });
        }
      }

      if (taskId) {
        try {
          await this.deps.memory.saveAgentState({
            taskId,
            agentName: "planner",
            step: "planned",
            progress: 0.8,
            status: "running",
            context: { tasks: tasks.length, planId: "mock-plan" },
            memoryRefs: [],
          });
        } catch {}
      }
      return {
        text: JSON.stringify({
          objective: ctx.text,
          context: contextStr,
          goalId: goalContext?.id,
          plannerEngine: plannerEngine ?? (llmEnabled ? "llm" : planningEngineEnabled ? "heuristic" : "default"),
          tasks,
        }),
        meta: { planId: "mock-plan" },
      };
    } finally {
      span.end();
    }
  }
}
