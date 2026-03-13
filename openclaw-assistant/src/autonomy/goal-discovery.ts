import type { AgentDeps } from "../agents/agent-deps.js";

export type DiscoveredGoal = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  rationale: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

export class GoalBacklog {
  private goals: DiscoveredGoal[] = [];

  add(goal: DiscoveredGoal) {
    this.goals.push(goal);
    this.goals.sort((a, b) => (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0));
  }

  pull(max = 5) {
    return this.goals.splice(0, max);
  }

  list() {
    return [...this.goals];
  }
}

export class GoalDiscoveryEngine {
  private backlog = new GoalBacklog();

  constructor(private readonly deps: AgentDeps) {}

  async analyzeSignals() {
    const snapshot = await this.deps.queue.snapshot(50);
    const failed = snapshot.results.filter((r) => !r.ok);
    if (failed.length > 2) {
      this.backlog.add({
        id: `goal-${Date.now()}`,
        title: "Reduzir falhas em ferramentas críticas",
        priority: "high",
        rationale: "Falhas consecutivas detectadas",
        payload: { failures: failed.length },
        createdAt: Date.now(),
      });
      await this.deps.memory.add("event", "goal_discovered", {
        type: "reliability",
        failures: failed.length,
      });
    }
    const tasks = snapshot.tasks.filter((t) => t.type === "research");
    if (tasks.length > 5) {
      this.backlog.add({
        id: `goal-${Date.now()}-2`,
        title: "Criar skill de pesquisa especializada",
        priority: "medium",
        rationale: "Volume alto de pesquisas similares",
        payload: { count: tasks.length },
        createdAt: Date.now(),
      });
    }
  }

  takeNext(max = 3) {
    return this.backlog.pull(max);
  }
}
