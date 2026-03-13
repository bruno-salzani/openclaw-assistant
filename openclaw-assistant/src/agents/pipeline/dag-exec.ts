import type { AgentDeps } from "../agent-deps.js";
import type { Task, TaskResult, TaskType } from "../../tasks/task-types.js";
import { randomUUID } from "node:crypto";

export async function executeDAG(
  deps: AgentDeps,
  steps: Array<{
    id: string;
    type: TaskType;
    dependsOn: string[];
    payload?: Record<string, unknown>;
    priority?: "low" | "medium" | "high";
    agentType?: string;
  }>,
  ctx: {
    sessionId: string;
    userId: string;
    userRole: "user" | "admin" | "service";
    traceId: string;
  }
) {
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const levels: string[][] = [];
  const depsCount = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const s of steps) {
    depsCount.set(s.id, s.dependsOn.length);
    for (const d of s.dependsOn) children.set(d, [...(children.get(d) ?? []), s.id]);
  }
  const roots = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  if (roots.length) levels.push(roots);
  const visited = new Set(roots);
  while (true) {
    const last = levels[levels.length - 1] ?? [];
    const nextSet = new Set<string>();
    for (const n of last) {
      for (const c of children.get(n) ?? []) {
        const left = (depsCount.get(c) ?? 0) - 1;
        depsCount.set(c, left);
        if (left === 0 && !visited.has(c)) {
          nextSet.add(c);
          visited.add(c);
        }
      }
    }
    if (nextSet.size === 0) break;
    levels.push([...nextSet]);
  }

  const results: TaskResult[] = [];
  const index: Record<string, TaskType> = {};
  const stepIdByTaskId: Record<string, string> = {};
  const outputsByStepId: Record<string, unknown> = {};
  for (const level of levels) {
    const t0 = Date.now();
    const tasks: Task[] = level.map((id) => {
      const s = stepsById.get(id);
      if (!s) throw new Error(`Unknown step id: ${id}`);
      const payload = { ...(s.payload ?? {}) };
      if (s.type === "analyze" && !("inputs" in payload)) {
        payload.inputs = s.dependsOn
          .map((dep) => outputsByStepId[dep])
          .filter((v) => v !== undefined);
      }
      const taskId = randomUUID();
      const task: Task = {
        taskId,
        traceId: ctx.traceId,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        userRole: ctx.userRole,
        stepId: s.id,
        type: s.type,
        priority: s.priority ?? "medium",
        agentType: s.agentType,
        payload,
        status: "pending",
        createdAt: t0,
        updatedAt: t0,
      };
      return task;
    });
    for (const t of tasks) {
      index[t.taskId] = t.type;
      stepIdByTaskId[t.taskId] = String((t as any).stepId ?? "");
    }
    for (const t of tasks) await deps.queue.enqueue(t);
    const res = await Promise.all(tasks.map((t) => deps.queue.waitForResult(t.taskId)));
    results.push(...res);
    for (const r of res) {
      const stepId = stepIdByTaskId[r.taskId];
      if (stepId) outputsByStepId[stepId] = r.output;
    }
  }
  return { results, index, stepIdByTaskId };
}
