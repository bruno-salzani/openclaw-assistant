import fs from "node:fs";
import path from "node:path";
import type { AgentObsEvent } from "../observability/agent-tracker.js";

export type ReputationRow = {
  agent: string;
  score: number;
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

export class ReputationSystem {
  private readonly byAgent = new Map<string, ReputationRow>();

  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    const p = String(process.env.IA_ASSISTANT_SWARM_REPUTATION_PATH ?? "").trim();
    if (p) return path.resolve(this.baseDir, p);
    return path.join(this.baseDir, ".ia-assistant", "swarm", "reputation.json");
  }

  load() {
    const p = this.filePath();
    try {
      if (!fs.existsSync(p)) return;
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.agents) ? parsed.agents : [];
      this.byAgent.clear();
      for (const r of rows) {
        const agent = String(r?.agent ?? "").trim();
        if (!agent) continue;
        const row: ReputationRow = {
          agent,
          score: clamp(Number(r?.score ?? 0.5), 0, 1),
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
    const agents = [...this.byAgent.values()].sort((a, b) => b.score - a.score).slice(0, 200);
    fs.writeFileSync(p, JSON.stringify({ agents }, null, 2));
  }

  get(agent: string) {
    return this.byAgent.get(agent)?.score ?? 0.5;
  }

  onAgentObs(evt: AgentObsEvent) {
    const agent = String(evt?.agent ?? "").trim();
    if (!agent) return;
    const row =
      this.byAgent.get(agent) ??
      ({
        agent,
        score: 0.5,
        runs: 0,
        ok: 0,
        fail: 0,
        updatedAt: Date.now(),
      } as ReputationRow);
    row.runs += 1;
    if (evt.ok) row.ok += 1;
    else row.fail += 1;
    const successRate = row.runs > 0 ? row.ok / row.runs : 0.5;
    row.score = clamp(0.3 + 0.7 * successRate, 0, 1);
    row.updatedAt = Date.now();
    this.byAgent.set(agent, row);
  }
}

