export type TaskType = "research" | "execute" | "analyze";

export type TaskPriority = "low" | "medium" | "high";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "retrying";

export type Task = {
  taskId: string;
  traceId: string;
  sessionId: string;
  userId: string;
  userRole: "user" | "admin" | "service";
  workflowId?: string;
  stepId?: string;
  agentType?: string;
  assignedNodeId?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type TaskResult = {
  taskId: string;
  traceId: string;
  ok: boolean;
  output?: unknown;
  error?: { message: string; code?: string };
  meta?: {
    latencyMs?: number;
    toolCalls?: number;
  };
};
