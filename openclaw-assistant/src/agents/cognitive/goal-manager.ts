import type { AgentDeps } from "../agent-deps.js";

export type Goal = {
  id: string;
  description: string;
  type: string;
  status: "active" | "completed" | "failed" | "pending";
  subtasks: string[];
  createdAt: number;
};

export class GoalManager {
  private goals: Map<string, Goal> = new Map();

  constructor(private readonly deps: AgentDeps) {}

  async createGoal(description: string, type: string): Promise<Goal> {
    const id = `goal_${Date.now()}`;
    const goal: Goal = {
      id,
      description,
      type,
      status: "active",
      subtasks: [],
      createdAt: Date.now(),
    };

    this.goals.set(id, goal);

    // Decompose Goal (Simplified Simulation)
    if (type === "productivity") {
      goal.subtasks = ["organize_schedule", "prioritize_tasks", "check_conflicts"];
    } else if (type === "travel") {
      goal.subtasks = ["search_flights", "compare_prices", "book_hotel", "create_itinerary"];
    }

    // Persist
    await this.deps.memory.add("long-term", JSON.stringify(goal), { type: "goal", goalId: id });

    return goal;
  }

  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  getActiveGoals(): Goal[] {
    return Array.from(this.goals.values()).filter((g) => g.status === "active");
  }

  async updateStatus(id: string, status: Goal["status"]) {
    const goal = this.goals.get(id);
    if (goal) {
      goal.status = status;
      await this.deps.memory.add("long-term", JSON.stringify(goal), {
        type: "goal_update",
        goalId: id,
      });
    }
  }
}
