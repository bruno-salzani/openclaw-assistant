export type WorkflowAction =
  | { type: "extract_data"; schema: Record<string, string> }
  | { type: "parallel"; actions: WorkflowAction[] }
  | { type: string; [key: string]: unknown }; // Generic fallback for tool calls

export type Workflow = {
  name: string;
  trigger: { type: string; filter?: string; cron?: string };
  actions: WorkflowAction[];
};
