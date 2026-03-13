import fs from "node:fs";
import path from "node:path";
import type { AgentProfile } from "./agent-profile.js";

function clampTemp(v: number) {
  if (!Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(2, v));
}

function safeReadJson(p: string) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class AgentProfileRegistry {
  private readonly profiles = new Map<string, AgentProfile>();

  constructor(private readonly deps: { baseDir: string }) {
    for (const p of this.defaultProfiles()) this.profiles.set(p.id, p);
    this.reload();
  }

  private defaultProfiles(): AgentProfile[] {
    return [
      { id: "research", style: "academic", sources: "scientific", temperature: 0.2 },
      { id: "analyst", style: "formal", sources: "primary", temperature: 0.2 },
      { id: "finance", style: "formal", sources: "primary", temperature: 0.1 },
      { id: "reliability", style: "concise", sources: "primary", temperature: 0.1 },
      { id: "planner", style: "formal", sources: "general", temperature: 0.2 },
      { id: "executor", style: "concise", sources: "primary", temperature: 0.2 },
      { id: "reviewer", style: "formal", sources: "primary", temperature: 0.1 },
      { id: "coordinator", style: "formal", sources: "general", temperature: 0.2 },
    ];
  }

  private profileFile() {
    const envPath = String(process.env.IA_ASSISTANT_AGENT_PROFILES_PATH ?? "").trim();
    if (envPath) return path.resolve(this.deps.baseDir, envPath);
    return path.join(this.deps.baseDir, ".ia-assistant", "agent-profiles.json");
  }

  reload() {
    const p = this.profileFile();
    const json = safeReadJson(p);
    if (!json || typeof json !== "object") return;
    const entries = Array.isArray((json as any).profiles) ? (json as any).profiles : json;
    const arr = Array.isArray(entries) ? entries : [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const id = String((item as any).id ?? "").trim();
      if (!id) continue;
      const profile: AgentProfile = {
        id,
        style: (item as any).style,
        sources: (item as any).sources,
        temperature: clampTemp(Number((item as any).temperature)),
        system: typeof (item as any).system === "string" ? String((item as any).system) : undefined,
      };
      this.profiles.set(id, profile);
    }
  }

  get(id: string) {
    return this.profiles.get(String(id ?? "").trim());
  }

  list() {
    return Array.from(this.profiles.values());
  }
}

