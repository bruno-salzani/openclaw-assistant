import path from "node:path";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { AgentEconomy } from "../economy/agent-economy.js";
import { generateAgentPlugin } from "../agent-factory/agent-generator.js";
import type { AgentBlueprint } from "../agent-factory/types.js";

export type AgentGenome = {
  id: string;
  agent: string;
  role: string;
  capabilities: string[];
  description: string;
};

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

function capabilitiesForRole(role: string) {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "research") return ["web.search", "web.fetch", "browser.search", "browser.fetch"];
  if (r === "executor") return ["terminal.run", "filesystem.write", "filesystem.read", "docker.run_container"];
  if (r === "reviewer") return [];
  if (r === "planner") return ["tool_intelligence.recommend"];
  if (r === "analyst") return ["csv.parse", "postgres.query"];
  return ["web.search", "web.fetch"];
}

export class AgentEvolutionEngine {
  constructor(
    private readonly deps: {
      metrics: MetricsRegistry;
      memory: MemorySystem;
      economy: AgentEconomy;
      repoRoot: string;
    }
  ) {
    this.deps.metrics.createCounter("agent_evolution_runs_total", "Total number of agent evolution runs");
  }

  private pickCandidates(limit: number) {
    const rows = this.deps.economy.list(500);
    const sorted = rows.slice().sort((a, b) => a.reputation - b.reputation);
    return sorted.slice(0, Math.max(1, Math.min(20, limit)));
  }

  async runOnce(params?: { limit?: number; outDir?: string }) {
    this.deps.metrics.counter("agent_evolution_runs_total").inc();
    const limit = typeof params?.limit === "number" ? Math.max(1, Math.min(10, Math.floor(params.limit))) : 3;
    const outDir = params?.outDir
      ? path.resolve(this.deps.repoRoot, String(params.outDir))
      : path.join(this.deps.repoRoot, ".ia-assistant", "agent-evolution", "generated");

    const candidates = this.pickCandidates(limit);
    const genomes: AgentGenome[] = candidates.map((c) => {
      const agent = String(c.agent ?? "").trim();
      const role = agent.split(":")[0]?.trim().toLowerCase() || agent.toLowerCase();
      return {
        id: `${agent}:${Date.now()}`,
        agent,
        role,
        capabilities: uniq(capabilitiesForRole(role)),
        description: `Auto-evolved variant for ${agent} (rep=${c.reputation.toFixed(2)})`,
      };
    });

    const proposals = genomes.map((g) => {
      const blueprint: AgentBlueprint = {
        name: `${g.agent}-evolved`,
        description: g.description,
        capabilities: g.capabilities,
        tools: g.capabilities,
        skills: [],
        memory: "episodic",
      };
      const plugin = generateAgentPlugin({
        blueprint,
        outDir,
        role: g.role || "automation",
      });
      return { genome: g, plugin };
    });

    await this.deps.memory.add("event", "agent_evolution_run", {
      ts: Date.now(),
      proposals: proposals.map((p) => ({ agent: p.genome.agent, role: p.genome.role, plugin: p.plugin.name, version: p.plugin.version })),
    });

    return { ok: true, outDir, proposals };
  }
}
