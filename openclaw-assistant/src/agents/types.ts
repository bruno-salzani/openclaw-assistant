export type AgentRole =
  | "planner"
  | "research"
  | "executor"
  | "analyst"
  | "finance"
  | "reliability"
  | "curator"
  | "simulation"
  | "experiment"
  | "document"
  | "notification"
  | "automation"
  | "reviewer"
  | "coordinator";

export type AgentContext = {
  sessionId: string;
  userId: string;
  userRole?: "user" | "admin" | "service";
  channel: string;
  text: string;
  metadata?: Record<string, unknown>;
  history?: { role: string; content: string }[];
};

export type AgentResult = {
  text: string;
  meta?: Record<string, unknown>;
  toolCalls?: { name: string; input: any; output: any }[];
};

export interface Agent {
  role: AgentRole;
  handle(ctx: AgentContext): Promise<AgentResult>;
}
