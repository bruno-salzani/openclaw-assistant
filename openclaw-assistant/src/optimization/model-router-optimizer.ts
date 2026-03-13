import fs from "node:fs";
import path from "node:path";
import type { EventBus } from "../infra/event-bus.js";

type RoutedEvent = {
  route: string;
  provider?: string;
  totalChars?: number;
  lastNonSystemChars?: number;
  ts: number;
};

type AgentObsEvent = {
  agent: string;
  ok: boolean;
  costUsd?: number;
  latencyMs?: number;
  ts: number;
};

export type ModelRouterOptimizerState = {
  enabled: boolean;
  budgetUsdPerRun: number;
  window: number;
  reasoningMinChars: number;
  longPromptLastMinChars: number;
  lastAdjustmentAt?: number;
  lastDecision?: {
    avgCostUsd: number;
    reasoningShare: number;
    action: "increase" | "decrease" | "hold";
    newReasoningMinChars: number;
    newLongPromptLastMinChars: number;
  };
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function readNumEnv(key: string, fallback: number) {
  const v = Number(process.env[key] ?? fallback);
  return Number.isFinite(v) ? v : fallback;
}

export class ModelRouterOptimizer {
  private routed: RoutedEvent[] = [];

  private obs: AgentObsEvent[] = [];

  private timer: any = null;

  private state: ModelRouterOptimizerState;

  constructor(
    private readonly deps: { bus: EventBus; baseDir?: string },
    private readonly config?: {
      budgetUsdPerRun?: number;
      window?: number;
      evaluateEveryMs?: number;
    }
  ) {
    const budgetUsdPerRun = Number(config?.budgetUsdPerRun ?? readNumEnv("IA_ASSISTANT_OPTIMIZER_BUDGET_USD_PER_RUN", 0.002));
    const window = Number(config?.window ?? readNumEnv("IA_ASSISTANT_OPTIMIZER_WINDOW", 40));
    const reasoningMinChars = Number(readNumEnv("IA_ASSISTANT_LLM_REASONING_MIN_CHARS", 8000));
    const longPromptLastMinChars = Number(readNumEnv("IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS", 800));
    this.state = {
      enabled: true,
      budgetUsdPerRun: Number.isFinite(budgetUsdPerRun) ? budgetUsdPerRun : 0.002,
      window: Number.isFinite(window) ? window : 40,
      reasoningMinChars: Number.isFinite(reasoningMinChars) ? reasoningMinChars : 8000,
      longPromptLastMinChars: Number.isFinite(longPromptLastMinChars) ? longPromptLastMinChars : 800,
    };
  }

  start() {
    this.deps.bus.on("llm.routed", (evt: any) => {
      const e: RoutedEvent = {
        route: String(evt?.route ?? ""),
        provider: typeof evt?.provider === "string" ? String(evt.provider) : undefined,
        totalChars: Number.isFinite(evt?.totalChars) ? Number(evt.totalChars) : undefined,
        lastNonSystemChars: Number.isFinite(evt?.lastNonSystemChars) ? Number(evt.lastNonSystemChars) : undefined,
        ts: typeof evt?.ts === "number" ? Number(evt.ts) : Date.now(),
      };
      if (!e.route) return;
      this.routed.push(e);
      const max = Math.max(20, Math.min(1000, this.state.window * 10));
      if (this.routed.length > max) this.routed.splice(0, this.routed.length - max);
    });

    this.deps.bus.on("ai.observability", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      const e: AgentObsEvent = {
        agent: String(evt.agent ?? ""),
        ok: Boolean(evt.ok),
        costUsd: Number.isFinite(evt.costUsd) ? Number(evt.costUsd) : undefined,
        latencyMs: Number.isFinite(evt.latencyMs) ? Number(evt.latencyMs) : undefined,
        ts: Date.now(),
      };
      if (!e.agent) return;
      this.obs.push(e);
      const max = Math.max(20, Math.min(2000, this.state.window * 20));
      if (this.obs.length > max) this.obs.splice(0, this.obs.length - max);
    });

    const evaluateEveryMs = clamp(
      Number(this.config?.evaluateEveryMs ?? readNumEnv("IA_ASSISTANT_OPTIMIZER_EVAL_MS", 30_000)),
      5_000,
      5 * 60_000
    );
    this.timer = setInterval(() => {
      try {
        this.evaluateAndApply();
      } catch {}
    }, evaluateEveryMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState() {
    return { ...this.state };
  }

  private persist() {
    const baseDir = this.deps.baseDir ?? process.cwd();
    const p = path.join(baseDir, ".ia-assistant", "optimization", "model-router.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(this.state, null, 2));
  }

  evaluateAndApply() {
    const window = Math.max(10, Math.min(200, Number(this.state.window)));
    const obs = this.obs.slice(-window);
    const costs = obs.map((o) => Number(o.costUsd ?? 0)).filter((c) => Number.isFinite(c) && c >= 0);
    const avgCostUsd = costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : 0;

    const routed = this.routed.slice(-window);
    const reasoningCount = routed.filter((r) => r.route === "reasoning").length;
    const reasoningShare = routed.length ? reasoningCount / routed.length : 0;

    const budget = clamp(Number(this.state.budgetUsdPerRun), 0, 1);
    const currentReasoningMinChars = clamp(Number(this.state.reasoningMinChars), 2000, 80_000);
    const currentLongPromptLastMinChars = clamp(Number(this.state.longPromptLastMinChars), 200, 4000);

    const adjustStepChars = clamp(Number(readNumEnv("IA_ASSISTANT_OPTIMIZER_STEP_CHARS", 1000)), 200, 5000);
    const adjustStepLast = clamp(Number(readNumEnv("IA_ASSISTANT_OPTIMIZER_STEP_LAST_CHARS", 50)), 10, 300);

    let action: "increase" | "decrease" | "hold" = "hold";
    let nextReasoningMinChars = currentReasoningMinChars;
    let nextLongPromptLastMinChars = currentLongPromptLastMinChars;

    if (avgCostUsd > budget && reasoningShare >= 0.35) {
      action = "increase";
      nextReasoningMinChars = clamp(currentReasoningMinChars + adjustStepChars, 2000, 80_000);
      nextLongPromptLastMinChars = clamp(currentLongPromptLastMinChars + adjustStepLast, 200, 4000);
    } else if (avgCostUsd < budget * 0.5 && reasoningShare <= 0.15) {
      action = "decrease";
      nextReasoningMinChars = clamp(currentReasoningMinChars - adjustStepChars, 2000, 80_000);
      nextLongPromptLastMinChars = clamp(currentLongPromptLastMinChars - adjustStepLast, 200, 4000);
    }

    if (action !== "hold") {
      process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS = String(nextReasoningMinChars);
      process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS = String(nextLongPromptLastMinChars);
      this.state.reasoningMinChars = nextReasoningMinChars;
      this.state.longPromptLastMinChars = nextLongPromptLastMinChars;
      this.state.lastAdjustmentAt = Date.now();
      this.state.lastDecision = {
        avgCostUsd,
        reasoningShare,
        action,
        newReasoningMinChars: nextReasoningMinChars,
        newLongPromptLastMinChars: nextLongPromptLastMinChars,
      };
      this.persist();
    }

    return { ok: true, avgCostUsd, reasoningShare, action };
  }
}

