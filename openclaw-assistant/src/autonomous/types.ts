import type { AgentDeps } from "../agents/agent-deps.js";

export type TriggerSpec =
  | { kind: "interval"; everyMs: number }
  | { kind: "cron"; expression: string }
  | { kind: "event"; topic: string }
  | { kind: "goal"; name: string };

export type AutonomousAgentContext = {
  runId: string;
  trigger: TriggerSpec;
  topic?: string;
  payload?: unknown;
  goal?: string;
  workspaceId?: string;
};

export type AutonomousAgent = {
  id: string;
  description: string;
  triggers: TriggerSpec[];
  run: (deps: AgentDeps, ctx: AutonomousAgentContext) => Promise<void>;
};

