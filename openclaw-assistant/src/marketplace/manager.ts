import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Agent } from "../agents/types.js";
import type { AgentDeps } from "../agents/agent-deps.js";
import { AgentFactory } from "../agents/factory.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { ToolRegistry as ManifestRegistry } from "../tools/registry/tool-registry.js";
import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { TaskWorkerPool } from "../tasks/worker-pool.js";
import { loadOpenClawTools } from "../openclaw/tools/loader.js";
import { Marketplace } from "./registry.js";
import { loadMarketplace } from "./loader.js";
import { MarketplaceStore } from "./store.js";
import { loadOpenClawSkills } from "../integrations/openclaw/skills-adapter.js";

function readJsonSafe(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

type PluginManifest = {
  name: string;
  version?: string;
  type: "agent" | "tool" | "skill";
  entry?: string;
  description?: string;
  permissions?: string[];
};

function readPluginManifest(dir: string): PluginManifest | null {
  const p = path.join(dir, "plugin.json");
  if (!fs.existsSync(p)) return null;
  const raw = readJsonSafe(p);
  if (!raw || typeof raw !== "object") return null;
  const type = String((raw as any).type ?? "");
  if (type !== "agent" && type !== "tool" && type !== "skill") return null;
  const name = String((raw as any).name ?? "");
  if (!name.trim()) return null;
  const permissions = Array.isArray((raw as any).permissions)
    ? (raw as any).permissions.map(String).slice(0, 100)
    : undefined;
  return {
    name,
    version: typeof (raw as any).version === "string" ? String((raw as any).version) : undefined,
    type,
    entry: typeof (raw as any).entry === "string" ? String((raw as any).entry) : undefined,
    description:
      typeof (raw as any).description === "string" ? String((raw as any).description) : undefined,
    permissions,
  };
}

export class MarketplaceManager {
  private readonly store: MarketplaceStore;

  constructor(
    private readonly deps: {
      repoPath: string;
      baseDir?: string;
      agentDeps: AgentDeps;
      orchestrator: AgentOrchestrator;
      workerPool: TaskWorkerPool;
      skills: SkillMarketplace;
      tools: ToolExecutionEngine;
      toolRegistry?: ManifestRegistry;
      metrics: MetricsRegistry;
    }
  ) {
    this.store = new MarketplaceStore(this.deps.baseDir ?? process.cwd());
  }

  listAvailable() {
    const m = new Marketplace();
    loadMarketplace(this.deps.repoPath, m);
    const state = this.store.read();
    return {
      repoPath: this.deps.repoPath,
      available: m,
      installed: state.installed,
    };
  }

  install(kind: "agent" | "skill" | "tool", name: string) {
    return this.store.install(kind, name);
  }

  async applyInstalled() {
    const repoPath = this.deps.repoPath;
    const state = this.store.read();

    const skillsDir = path.join(repoPath, "skills");
    if (fs.existsSync(skillsDir) && state.installed.skills.length > 0) {
      loadOpenClawSkills(repoPath, this.deps.skills, this.deps.metrics, state.installed.skills);
    }

    const extDir = path.join(repoPath, "extensions");
    if (fs.existsSync(extDir) && state.installed.tools.length > 0) {
      await loadOpenClawTools({
        extensionsDir: extDir,
        metrics: this.deps.metrics,
        engine: this.deps.tools,
        manifestRegistry: this.deps.toolRegistry,
        bustImportCache: true,
        allowlist: state.installed.tools,
      });
    }

    const agentsDir = path.join(repoPath, "agents");
    const loadedAgents: Agent[] = [];
    if (fs.existsSync(agentsDir) && state.installed.agents.length > 0) {
      const factory = new AgentFactory(this.deps.agentDeps);
      for (const name of state.installed.agents) {
        const root = path.join(agentsDir, name);
        const plugin = readPluginManifest(root);
        if (plugin && plugin.type === "agent" && plugin.entry) {
          const entry = path.resolve(root, plugin.entry);
          if (fs.existsSync(entry) && entry.endsWith(".js")) {
            const url = pathToFileURL(entry).toString() + `?t=${Date.now()}`;
            try {
              const mod: any = await import(url);
              const registerFn =
                typeof mod?.register === "function"
                  ? mod.register
                  : typeof mod?.default === "function"
                    ? mod.default
                    : null;
              if (registerFn) {
                await registerFn({
                  name: plugin.name,
                  version: plugin.version,
                  permissions: plugin.permissions ?? [],
                  registerAgentSpec: async (spec: any) => {
                    const s = {
                      id: typeof spec?.id === "string" ? String(spec.id) : plugin.name,
                      role: typeof spec?.role === "string" ? String(spec.role) : "automation",
                      capabilities: Array.isArray(spec?.capabilities)
                        ? spec.capabilities.map(String)
                        : plugin.permissions ?? [],
                      systemPrompt: typeof spec?.systemPrompt === "string" ? String(spec.systemPrompt) : "",
                    };
                    const agent = factory.createAgent(s as any);
                    loadedAgents.push(agent);
                    (this.deps.orchestrator as any).registerAgent?.(agent);
                    (this.deps.workerPool as any).registerAgent?.(agent);
                    return agent;
                  },
                  registerAgent: async (agent: any) => {
                    if (!agent || typeof agent !== "object") return;
                    if (typeof agent.role !== "string" || typeof agent.handle !== "function") return;
                    loadedAgents.push(agent as Agent);
                    (this.deps.orchestrator as any).registerAgent?.(agent);
                    (this.deps.workerPool as any).registerAgent?.(agent);
                  },
                  deps: this.deps.agentDeps,
                  tools: this.deps.tools,
                  skills: this.deps.skills,
                  metrics: this.deps.metrics,
                });
                continue;
              }
            } catch {}
          }
        }
        const manifestPath = path.join(root, "agent.json");
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = readJsonSafe(manifestPath);
        if (!manifest || typeof manifest !== "object") continue;
        const spec = {
          id: typeof manifest.id === "string" ? String(manifest.id) : String(name),
          role: typeof manifest.role === "string" ? String(manifest.role) : "automation",
          capabilities: Array.isArray(manifest.capabilities)
            ? manifest.capabilities.map(String)
            : [],
          systemPrompt:
            typeof manifest.systemPrompt === "string" ? String(manifest.systemPrompt) : "",
        };
        const agent = factory.createAgent(spec);
        loadedAgents.push(agent);
        (this.deps.orchestrator as any).registerAgent?.(agent);
        (this.deps.workerPool as any).registerAgent?.(agent);
      }
    }

    return {
      ok: true,
      installed: state.installed,
      loaded: {
        agents: loadedAgents.map((a) => a.role),
      },
    };
  }
}
