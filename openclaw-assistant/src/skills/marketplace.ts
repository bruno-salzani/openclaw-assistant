import type { MetricsRegistry } from "../observability/metrics.js";
import type { Skill } from "./skill-types.js";

export class SkillMarketplace {
  private readonly skills = new Map<string, Skill>();

  private readonly metrics: MetricsRegistry;

  constructor(metrics: MetricsRegistry) {
    this.metrics = metrics;
  }

  register(skill: Skill) {
    this.skills.set(skill.id, skill);
    if (skill.init) {
      skill.init().catch(console.error);
    }
  }

  get(id: string) {
    return this.skills.get(id);
  }

  list() {
    return [...this.skills.values()].map((s) => ({ id: s.id, description: s.description }));
  }

  // Registers all skill commands into the execution engine
  registerTools(registerFn: (name: string, handler: (input: any) => Promise<any>) => void) {
    for (const skill of this.skills.values()) {
      for (const cmd of skill.commands) {
        registerFn(`${skill.id}.${cmd.name}`, cmd.run);
      }
    }
  }
}
