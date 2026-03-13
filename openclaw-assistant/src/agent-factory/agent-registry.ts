import fs from "node:fs";
import path from "node:path";
import type { AgentRegistryEntry } from "./types.js";

export type AgentRegistryState = {
  agents: AgentRegistryEntry[];
};

function defaultState(): AgentRegistryState {
  return { agents: [] };
}

function semverParts(v: string) {
  const m = String(v ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function semverGt(a: string, b: string) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return false;
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  return pa.patch > pb.patch;
}

function normalizeName(name: string) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export class AgentRegistry {
  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    return path.join(this.baseDir, ".ia-assistant", "agents-registry.json");
  }

  read(): AgentRegistryState {
    const p = this.filePath();
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
      return {
        agents: agents
          .map((a: any) => ({
            name: normalizeName(String(a?.name ?? "")),
            version: typeof a?.version === "string" ? String(a.version) : "0.0.0",
            description: typeof a?.description === "string" ? String(a.description) : undefined,
            capabilities: uniq(Array.isArray(a?.capabilities) ? a.capabilities : []),
            tools: uniq(Array.isArray(a?.tools) ? a.tools : []),
            skills: uniq(Array.isArray(a?.skills) ? a.skills : []),
            createdAt: Number(a?.createdAt ?? Date.now()),
            updatedAt: Number(a?.updatedAt ?? Date.now()),
          }))
          .filter((a: AgentRegistryEntry) => Boolean(a.name)),
      };
    } catch {
      return defaultState();
    }
  }

  write(state: AgentRegistryState) {
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  }

  list() {
    return this.read().agents;
  }

  get(name: string) {
    const n = normalizeName(name);
    return this.read().agents.find((a) => a.name === n) ?? null;
  }

  findAgents(requiredCapabilities: string[]) {
    const req = new Set(requiredCapabilities.map(String).map((s) => s.trim()).filter(Boolean));
    if (req.size === 0) return [];
    const agents = this.read().agents;
    return agents
      .filter((a) => {
        const caps = new Set(a.capabilities.map((c) => c.toLowerCase()));
        for (const r of req) {
          if (!caps.has(String(r).toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => (semverGt(a.version, b.version) ? -1 : semverGt(b.version, a.version) ? 1 : 0));
  }

  upsert(entry: Omit<AgentRegistryEntry, "name" | "createdAt" | "updatedAt"> & { name: string }) {
    const state = this.read();
    const now = Date.now();
    const name = normalizeName(entry.name);
    const next: AgentRegistryEntry = {
      name,
      version: typeof entry.version === "string" ? String(entry.version) : "0.0.0",
      description: typeof (entry as any).description === "string" ? String((entry as any).description) : undefined,
      capabilities: uniq(entry.capabilities ?? []),
      tools: uniq(entry.tools ?? []),
      skills: uniq(entry.skills ?? []),
      createdAt: now,
      updatedAt: now,
    };
    const idx = state.agents.findIndex((a) => a.name === name);
    if (idx >= 0) {
      const prev = state.agents[idx]!;
      state.agents[idx] = {
        ...prev,
        ...next,
        createdAt: prev.createdAt,
        updatedAt: now,
      };
    } else {
      state.agents.push(next);
    }
    this.write(state);
    return this.get(name);
  }
}

