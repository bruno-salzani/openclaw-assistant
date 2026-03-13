import type { AgentDeps } from "../../agents/agent-deps.js";
import type { AgentContext } from "../../agents/types.js";
import type { Task, TaskResult } from "../../tasks/task-types.js";
import { PlannerAgent } from "../roles/planner-agent.js";
import { ReviewerAgent } from "../roles/reviewer-agent.js";

export class OrchestrationPipeline {
  constructor(private readonly deps: AgentDeps) {}

  async plan(ctx: AgentContext): Promise<{
    tasks?: Array<{ type: string; priority?: string; payload?: Record<string, unknown> }>;
    steps?: any[];
  }> {
    const planResult = await new PlannerAgent(this.deps).handle(ctx);
    try {
      return JSON.parse(planResult.text);
    } catch {
      return { steps: [] };
    }
  }

  async dispatch(tasks: Task[], timeoutMs = 90_000): Promise<TaskResult[]> {
    for (const t of tasks) await this.deps.queue.enqueue(t);
    const results = await Promise.all(
      tasks.map((t) => this.deps.queue.waitForResult(t.taskId, timeoutMs))
    );
    return results;
  }

  aggregate(results: TaskResult[]) {
    const ok = results.filter((r) => r.ok);
    const research = ok.filter((r) => JSON.stringify(r.output ?? "").includes("research"));
    const execution = ok.filter((r) => JSON.stringify(r.output ?? "").includes("execution"));
    return { research, execution };
  }

  async review(ctx: AgentContext, text: string) {
    return new ReviewerAgent(this.deps).handle({ ...ctx, text });
  }
}
