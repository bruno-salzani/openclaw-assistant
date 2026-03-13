import type { AgentDeps } from "../agents/agent-deps.js";
import { AutonomousScheduler } from "./scheduler.js";
import type { AutonomousAgent } from "./types.js";
import { buildSecurityAgent } from "./agents/security-agent.js";
import { buildResearchAgent } from "./agents/research-agent.js";
import { buildEvolverReviewAgent } from "./agents/evolver-review-agent.js";

export class AutonomousAgentManager {
  private readonly scheduler: AutonomousScheduler;

  private started = false;

  constructor(
    private readonly deps: AgentDeps,
    private readonly options: { workspaceId: string; repoRoot: string }
  ) {
    this.scheduler = new AutonomousScheduler({
      bus: deps.bus,
      workspaceId: this.options.workspaceId,
    });
  }

  register(agent: AutonomousAgent) {
    if (this.started) throw new Error("AutonomousAgentManager already started");
    this.scheduler.register(agent);
  }

  registerBuiltIns() {
    this.register(buildSecurityAgent());
    this.register(buildResearchAgent());
    this.register(buildEvolverReviewAgent());
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.scheduler.start(this.deps);
  }

  stop() {
    if (!this.started) return;
    this.scheduler.stop();
    this.started = false;
  }

  listAgents() {
    return this.scheduler.listAgents();
  }

  triggerGoal(name: string, payload?: unknown) {
    return this.scheduler.triggerGoal(this.deps, name, payload);
  }
}
