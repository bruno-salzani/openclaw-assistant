import type { Task } from "../../tasks/task-types.js";
import { CivilizationRuntime } from "../../civilization/runtime.js";

export class TaskRouter {
  constructor(private readonly civ: CivilizationRuntime) {}

  route(tasks: Task[]) {
    const blocked: Array<{ taskId: string; reason?: string; requireHuman?: boolean }> = [];
    const routed: Task[] = [];
    for (const t of tasks) {
      const { decision, bid } = this.civ.assign(t);
      if (!decision.allow) {
        blocked.push({
          taskId: t.taskId,
          reason: decision.reason,
          requireHuman: decision.requireHuman,
        });
        continue;
      }
      if (bid?.agentType) t.agentType = bid.agentType;
      t.payload = {
        ...t.payload,
        civ: bid?.civilization,
        priceCredits: bid?.priceCredits,
        bidConfidence: bid?.confidence,
        bidReason: bid?.reason,
      };
      routed.push(t);
    }
    return { blocked, routed };
  }
}
