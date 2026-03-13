import type { AgentContext } from "../types.js";

export type AgentGraphNode<TOutput = unknown> = {
  id: string;
  run: (ctx: AgentContext, inputs: Record<string, unknown>) => Promise<TOutput> | TOutput;
};
