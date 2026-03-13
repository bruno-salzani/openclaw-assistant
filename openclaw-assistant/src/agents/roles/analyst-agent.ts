import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class AnalystAgent implements Agent {
  role: Agent["role"] = "analyst";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.analyst", { sessionId: ctx.sessionId });
    try {
      this.deps.metrics.counter("analysis_runs_total").inc();
      const inputs = (ctx.metadata?.inputs ?? []) as unknown[];
      const asText = inputs
        .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
        .join("\n\n");
      const summary = [
        "Competitive analysis (draft):",
        "- Key themes: pricing, positioning, differentiation",
        "- Gaps: missing data points should be validated with sources",
        "",
        "Inputs:",
        asText,
      ].join("\n");
      return { text: summary, meta: { sourceCount: inputs.length } };
    } finally {
      span.end();
    }
  }
}
