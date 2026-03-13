import fs from "node:fs";
import path from "node:path";

export type MarketplaceInstallState = {
  installed: {
    agents: string[];
    skills: string[];
    tools: string[];
  };
};

function defaultState(): MarketplaceInstallState {
  return { installed: { agents: [], skills: [], tools: [] } };
}

export class MarketplaceStore {
  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    return path.join(this.baseDir, ".ia-assistant", "marketplace.json");
  }

  read(): MarketplaceInstallState {
    const p = this.filePath();
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const installed = parsed?.installed ?? {};
      return {
        installed: {
          agents: Array.isArray(installed.agents) ? installed.agents.map(String) : [],
          skills: Array.isArray(installed.skills) ? installed.skills.map(String) : [],
          tools: Array.isArray(installed.tools) ? installed.tools.map(String) : [],
        },
      };
    } catch {
      return defaultState();
    }
  }

  write(state: MarketplaceInstallState) {
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  }

  install(kind: "agent" | "skill" | "tool", name: string) {
    const state = this.read();
    const key = kind === "agent" ? "agents" : kind === "skill" ? "skills" : "tools";
    const cur = new Set(state.installed[key].map(String));
    cur.add(String(name));
    state.installed[key] = Array.from(cur);
    this.write(state);
    return state;
  }
}
