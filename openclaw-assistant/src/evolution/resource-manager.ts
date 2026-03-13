import type { AgentDeps } from "../agents/agent-deps.js";

export type ResourceProfile = {
  cpuUsage: number;
  memoryUsage: number;
  apiCost: number;
  dailyBudget: number;
};

export type ModelTier = "small" | "medium" | "large";

export class ResourceManager {
  private currentUsage: ResourceProfile = {
    cpuUsage: 0,
    memoryUsage: 0,
    apiCost: 0,
    dailyBudget: 10.0, // $10/day
  };

  constructor(private readonly deps: AgentDeps) {}

  selectModel(
    taskComplexity: "low" | "medium" | "high",
    priority: "low" | "medium" | "high"
  ): ModelTier {
    // Check budget
    if (this.currentUsage.apiCost > this.currentUsage.dailyBudget * 0.9) {
      // Near budget limit, force cheaper models
      return "small";
    }

    if (priority === "high") {
      return "large";
    }

    if (taskComplexity === "high") {
      return "large";
    } else if (taskComplexity === "medium") {
      return "medium";
    } else {
      return "small";
    }
  }

  async trackUsage(cost: number, cpu: number, memory: number) {
    this.currentUsage.apiCost += cost;
    this.currentUsage.cpuUsage = cpu; // instantaneous
    this.currentUsage.memoryUsage = memory; // instantaneous

    // Log if threshold exceeded
    if (this.currentUsage.apiCost > this.currentUsage.dailyBudget) {
      await this.deps.memory.add("event", "Daily budget exceeded", {
        cost: this.currentUsage.apiCost,
      });
    }
  }

  getStats() {
    return { ...this.currentUsage };
  }
}
