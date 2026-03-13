import type { TaskResult } from "../tasks/task-types.js";

export function buildResponse(params: {
  planText: string;
  research: TaskResult[];
  execution?: TaskResult[];
  analysis?: TaskResult;
}): string {
  const parts: string[] = [];
  parts.push(`📋 **Plan Created**:\n${params.planText}`);
  for (const r of params.research) {
    parts.push(`🔍 **Research**: ${JSON.stringify(r.output)}`);
  }
  for (const e of params.execution ?? []) {
    parts.push(`⚙️ **Execution**: ${JSON.stringify(e.output)}`);
  }
  if (params.analysis) {
    parts.push(`📈 **Analysis**: ${JSON.stringify(params.analysis.output)}`);
  }
  return parts.join("\n\n") + "\n";
}
