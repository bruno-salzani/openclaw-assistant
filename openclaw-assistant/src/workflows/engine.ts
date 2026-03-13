import type { Workflow, WorkflowAction } from "./workflow-types.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import type { Task } from "../tasks/task-types.js";
import type { PermissionManager } from "../agents/security/permission-manager.js";

export class WorkflowEngine {
  private readonly workflows = new Map<string, Workflow>();

  private readonly metrics: MetricsRegistry;

  private readonly tools: ToolExecutionEngine;

  private readonly memory: MemorySystem;

  private readonly queue?: TaskQueue;

  private permissions?: PermissionManager;

  constructor(
    metrics: MetricsRegistry,
    tools: ToolExecutionEngine,
    memory: MemorySystem,
    queue?: TaskQueue,
    permissions?: PermissionManager
  ) {
    this.metrics = metrics;
    this.tools = tools;
    this.memory = memory;
    this.queue = queue;
    this.permissions = permissions;
    this.tools.registerWorkflowRunner(async (name, input) => this.execute(name, input));
  }

  setPermissions(permissions: PermissionManager) {
    this.permissions = permissions;
  }

  register(workflow: Workflow) {
    this.workflows.set(workflow.name, workflow);
  }

  list(): Workflow[] {
    return [...this.workflows.values()];
  }

  async execute(name: string, input: Record<string, unknown>) {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow not found: ${name}`);
    }
    this.metrics.counter("workflow_runs_total").inc();

    let context = { ...input };
    const outputs: unknown[] = [];

    // Log execution start
    const executionId = await this.memory.logExecutionStart(name, context);
    const start = Date.now();

    try {
      // Analyze dependencies for parallel execution
      // Current simple logic: if action has 'parallel: true', run in batch with next actions until 'parallel: false'
      // For now, we keep sequential but prepare structure

      for (const action of workflow.actions) {
        // Interpolate variables in action parameters
        const interpolatedAction = this.interpolate(action, context);
        const result = await this.runAction(interpolatedAction, context);

        outputs.push(result);
        if (typeof result === "object" && result !== null) {
          context = { ...context, ...result };
        }
      }

      await this.memory.logExecutionEnd(executionId, "completed", Date.now() - start);
      return { name, outputs, finalContext: context };
    } catch (err) {
      await this.memory.logExecutionEnd(executionId, "failed", Date.now() - start);
      throw err;
    }
  }

  private interpolate(action: any, context: Record<string, unknown>): any {
    const result: any = {};
    for (const key of Object.keys(action)) {
      const value = action[key];
      if (typeof value === "string") {
        result[key] = value.replace(/\$\{(.*?)\}/g, (_, v) => String(context[v] ?? ""));
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (typeof item === "string") {
            return item.replace(/\$\{(.*?)\}/g, (_, v) => String(context[v] ?? ""));
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private async runAction(action: WorkflowAction, input: Record<string, unknown>): Promise<any> {
    if ((action as any).type === "parallel" && Array.isArray((action as any).actions)) {
      const actions = (action as any).actions as WorkflowAction[];
      const results = await Promise.all(
        actions.map((act) => this.runAction(this.interpolate(act, input), input))
      );
      // Merge all results
      return results.reduce((acc, curr) => ({ ...acc, ...curr }), {});
    }

    if (String((action as any).type).startsWith("agent.")) {
      if (!this.queue) {
        throw new Error("Task queue not configured");
      }
      const agentType = String((action as any).type).split(".")[1] ?? "";
      const workflowId = String((input as any).workflowId ?? "");
      const stepId = String((action as any).step_id ?? (action as any).stepId ?? "");
      const t: Task = {
        taskId: crypto.randomUUID(),
        traceId: String((input as any).traceId ?? `wf-${Date.now()}`),
        sessionId: String((input as any).sessionId ?? "session:workflow"),
        userId: String((input as any).userId ?? "user:system"),
        userRole:
          (input as any).userRole === "admin"
            ? "admin"
            : (input as any).userRole === "service"
              ? "service"
              : "user",
        workflowId: workflowId || undefined,
        stepId: stepId || undefined,
        agentType,
        type:
          agentType === "document_parser"
            ? "analyze"
            : agentType === "notification_agent"
              ? "execute"
              : "research",
        priority: "medium",
        status: "pending",
        payload: (action as any).input ?? {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.queue.enqueue(t);
      this.metrics.counter("task_created_total").inc();
      const result = await this.queue.waitForResult(t.taskId);
      return { [`${agentType}_result`]: result.output };
    }
    // 1. Special Built-in Actions
    if (action.type === "extract_data" && "schema" in action) {
      const text = String(input.text ?? "");
      const schema = (action as any).schema as Record<string, string>;
      const extracted = Object.fromEntries(
        Object.keys(schema).map((key) => [key, text.includes(key) ? key : null])
      );
      this.memory.add("event", JSON.stringify({ type: "extract_data", extracted }));
      return extracted;
    }

    // 2. Generic Tool Execution
    // Try to execute as a tool if it matches a registered tool pattern (e.g. "postgres.query")
    try {
      // Remove 'type' from input arguments passed to the tool
      const { type, ...toolInput } = action;
      const userRole =
        (input as any).userRole === "admin"
          ? "admin"
          : (input as any).userRole === "service"
            ? "service"
            : "user";
      const workspaceId =
        typeof (input as any).workspaceId === "string"
          ? String((input as any).workspaceId)
          : undefined;
      const perms = this.permissions?.getPermissions("automation_agent", workspaceId) ?? [];
      return await this.tools.execute(type, toolInput as Record<string, any>, {
        userRole,
        permissions: perms,
        workspaceId,
      });
    } catch (err) {
      // Fallback for mock actions if tool not found (for prototype purposes)
      if (String(err).includes("not found")) {
        console.warn(`[Workflow] Tool ${action.type} not found, using mock.`);
        return { mock: true, action: action.type };
      }
      throw err;
    }
  }
}
