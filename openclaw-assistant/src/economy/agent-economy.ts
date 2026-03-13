import fs from "node:fs";
import path from "node:path";
import type { AgentObsEvent } from "../observability/agent-tracker.js";
import { tryParseJson } from "../infra/json.js";

export type AgentEconomyRow = {
  agent: string;
  reputation: number;
  credits: number;
  reward: number;
  costUsd: number;
  runs: number;
  ok: number;
  fail: number;
  updatedAt: number;
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export class AgentEconomy {
  private readonly byAgent = new Map<string, AgentEconomyRow>();

  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    const p = String(process.env.IA_ASSISTANT_AGENT_ECONOMY_PATH ?? "").trim();
    if (p) return path.resolve(this.baseDir, p);
    return path.join(this.baseDir, ".ia-assistant", "economy", "agents.json");
  }

  load() {
    const p = this.filePath();
    try {
      if (!fs.existsSync(p)) return;
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = tryParseJson<{ agents?: unknown }>(raw);
      const rows = Array.isArray(parsed?.agents) ? (parsed?.agents as any[]) : [];
      this.byAgent.clear();
      for (const r of rows) {
        const agent = String(r?.agent ?? "").trim();
        if (!agent) continue;
        const row: AgentEconomyRow = {
          agent,
          reputation: clamp(Number(r?.reputation ?? 0.5), 0, 1),
          credits: clamp(Number(r?.credits ?? 0), -1_000_000, 1_000_000),
          reward: clamp(Number(r?.reward ?? 0), -1_000_000, 1_000_000),
          costUsd: clamp(Number(r?.costUsd ?? 0), 0, 1_000_000),
          runs: Math.max(0, Number(r?.runs ?? 0) || 0),
          ok: Math.max(0, Number(r?.ok ?? 0) || 0),
          fail: Math.max(0, Number(r?.fail ?? 0) || 0),
          updatedAt: Math.max(0, Number(r?.updatedAt ?? Date.now()) || Date.now()),
        };
        this.byAgent.set(agent, row);
      }
    } catch {}
  }

  save() {
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const agents = [...this.byAgent.values()].sort((a, b) => b.reputation - a.reputation).slice(0, 500);
    fs.writeFileSync(p, JSON.stringify({ agents }, null, 2));
  }

  list(limit = 200) {
    return [...this.byAgent.values()].sort((a, b) => b.reputation - a.reputation).slice(0, limit);
  }

  get(agent: string) {
    return this.byAgent.get(agent);
  }

  private ensure(agent: string) {
    const a = String(agent ?? "").trim();
    if (!a) return null;
    const existing = this.byAgent.get(a);
    if (existing) return existing;
    const row: AgentEconomyRow = {
      agent: a,
      reputation: 0.5,
      credits: 0,
      reward: 0,
      costUsd: 0,
      runs: 0,
      ok: 0,
      fail: 0,
      updatedAt: Date.now(),
    };
    this.byAgent.set(a, row);
    return row;
  }

  onAgentObs(evt: AgentObsEvent) {
    const agent = String(evt?.agent ?? "").trim();
    const row = this.ensure(agent);
    if (!row) return;
    row.runs += 1;
    if (evt.ok) row.ok += 1;
    else row.fail += 1;
    const successRate = row.runs > 0 ? row.ok / row.runs : 0.5;
    row.reputation = clamp(0.25 + 0.75 * successRate, 0, 1);
    row.reward += evt.ok ? 1 : -1;
    row.credits += evt.ok ? 0.5 : -0.75;
    row.updatedAt = Date.now();
  }

  onToolExecuted(evt: { tool?: unknown; ok?: unknown; durationMs?: unknown; source?: unknown }) {
    const source = typeof evt?.source === "string" ? evt.source : "";
    const agent = source.startsWith("agent.") ? source.slice("agent.".length).split(".")[0] : "";
    const row = this.ensure(agent);
    if (!row) return;
    const ok = Boolean(evt?.ok);
    row.reward += ok ? 0.2 : -0.3;
    row.credits += ok ? 0.1 : -0.2;
    const durationMs = Number(evt?.durationMs ?? 0);
    if (Number.isFinite(durationMs) && durationMs > 0) row.costUsd += clamp(durationMs / 10_000_000, 0, 0.01);
    row.updatedAt = Date.now();
  }
}

