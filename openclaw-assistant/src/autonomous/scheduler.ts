import { randomUUID } from "node:crypto";
import type { EventBus } from "../infra/event-bus.js";
import type { AgentDeps } from "../agents/agent-deps.js";
import type { AutonomousAgent, AutonomousAgentContext, TriggerSpec } from "./types.js";

function parsePart(v: string) {
  const s = String(v ?? "").trim();
  if (s === "*") return { kind: "any" as const };
  if (s.startsWith("*/")) {
    const n = Number(s.slice(2));
    if (Number.isFinite(n) && n > 0) return { kind: "step" as const, step: Math.floor(n) };
  }
  const n = Number(s);
  if (Number.isFinite(n)) return { kind: "exact" as const, value: Math.floor(n) };
  return { kind: "invalid" as const };
}

function cronMatches(expr: string, d: Date) {
  const parts = String(expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = parts;
  const min = parsePart(minRaw);
  const hour = parsePart(hourRaw);
  const dom = parsePart(domRaw);
  const mon = parsePart(monRaw);
  const dow = parsePart(dowRaw);

  if (dom.kind !== "any" || mon.kind !== "any" || dow.kind !== "any") return false;
  if (min.kind === "invalid" || hour.kind === "invalid") return false;

  const m = d.getMinutes();
  const h = d.getHours();

  const okMin =
    min.kind === "any" ||
    (min.kind === "exact" && m === min.value) ||
    (min.kind === "step" && m % min.step === 0);
  const okHour =
    hour.kind === "any" ||
    (hour.kind === "exact" && h === hour.value) ||
    (hour.kind === "step" && h % hour.step === 0);
  return okMin && okHour;
}

type CronJob = { agent: AutonomousAgent; trigger: TriggerSpec & { kind: "cron" } };

type ListenerRef = { topic: string; fn: (payload: any) => void };

export class AutonomousScheduler {
  private readonly agents = new Map<string, AutonomousAgent>();

  private readonly timers: Array<ReturnType<typeof setInterval>> = [];

  private readonly listeners: ListenerRef[] = [];

  private readonly cronJobs: CronJob[] = [];

  private cronTimer: ReturnType<typeof setInterval> | null = null;

  private lastCronMinuteKey = "";

  private readonly running = new Set<string>();

  private readonly goals = new Map<string, AutonomousAgent[]>();

  constructor(
    private readonly deps: {
      bus?: EventBus;
      workspaceId: string;
    }
  ) {}

  register(agent: AutonomousAgent) {
    this.agents.set(agent.id, agent);
  }

  listAgents() {
    return Array.from(this.agents.values());
  }

  start(runtimeDeps: AgentDeps) {
    for (const agent of this.agents.values()) {
      for (const trigger of agent.triggers) {
        if (trigger.kind === "interval") {
          const ms = Math.max(1000, Number(trigger.everyMs));
          const h = setInterval(() => {
            this.runOnce(runtimeDeps, agent, trigger).catch(() => undefined);
          }, ms);
          if (typeof (h as any).unref === "function") (h as any).unref();
          this.timers.push(h);
        } else if (trigger.kind === "event") {
          const bus = this.deps.bus;
          if (!bus) continue;
          const fn = (payload: any) => {
            this.runOnce(runtimeDeps, agent, trigger, payload).catch(() => undefined);
          };
          bus.on(trigger.topic, fn);
          this.listeners.push({ topic: trigger.topic, fn });
        } else if (trigger.kind === "cron") {
          this.cronJobs.push({ agent, trigger });
        } else if (trigger.kind === "goal") {
          const list = this.goals.get(trigger.name) ?? [];
          list.push(agent);
          this.goals.set(trigger.name, list);
        }
      }
    }

    if (this.cronJobs.length > 0 && !this.cronTimer) {
      this.cronTimer = setInterval(() => {
        this.cronTick(runtimeDeps).catch(() => undefined);
      }, 15_000);
      if (typeof (this.cronTimer as any).unref === "function") (this.cronTimer as any).unref();
    }
  }

  stop() {
    for (const t of this.timers) {
      try {
        clearInterval(t);
      } catch {}
    }
    this.timers.length = 0;

    for (const l of this.listeners) {
      try {
        this.deps.bus?.off(l.topic, l.fn);
      } catch {}
    }
    this.listeners.length = 0;

    if (this.cronTimer) {
      try {
        clearInterval(this.cronTimer);
      } catch {}
    }
    this.cronTimer = null;
    this.cronJobs.length = 0;
    this.lastCronMinuteKey = "";
    this.running.clear();
    this.goals.clear();
  }

  async triggerGoal(runtimeDeps: AgentDeps, name: string, payload?: unknown) {
    const agents = this.goals.get(String(name)) ?? [];
    for (const agent of agents) {
      await this.runOnce(runtimeDeps, agent, { kind: "goal", name: String(name) }, payload);
    }
  }

  private async cronTick(runtimeDeps: AgentDeps) {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (key === this.lastCronMinuteKey) return;
    this.lastCronMinuteKey = key;

    for (const job of this.cronJobs) {
      if (!cronMatches(job.trigger.expression, now)) continue;
      await this.runOnce(runtimeDeps, job.agent, job.trigger);
    }
  }

  private async runOnce(
    runtimeDeps: AgentDeps,
    agent: AutonomousAgent,
    trigger: TriggerSpec,
    payload?: unknown
  ) {
    if (this.running.has(agent.id)) return;
    this.running.add(agent.id);
    const runId = randomUUID();
    const startedAt = Date.now();
    const ctx: AutonomousAgentContext = {
      runId,
      trigger,
      topic: trigger.kind === "event" ? trigger.topic : undefined,
      goal: trigger.kind === "goal" ? trigger.name : undefined,
      payload,
      workspaceId: this.deps.workspaceId,
    };
    try {
      runtimeDeps.metrics.counter("agent_runs_total").inc();
      this.deps.bus?.emit("autonomous.run.start", { agent: agent.id, runId, trigger });
      await agent.run(runtimeDeps, ctx);
      const durationMs = Date.now() - startedAt;
      this.deps.bus?.emit("autonomous.run.ok", { agent: agent.id, runId, durationMs, trigger });
    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      this.deps.bus?.emit("autonomous.run.error", {
        agent: agent.id,
        runId,
        durationMs,
        trigger,
        error: String(err?.message ?? err),
      });
      try {
        await runtimeDeps.memory.add("event", "autonomous_agent_error", {
          agent: agent.id,
          runId,
          durationMs,
          trigger,
          error: String(err?.message ?? err),
        });
      } catch {}
    } finally {
      this.running.delete(agent.id);
    }
  }
}

