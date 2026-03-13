import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class FinanceAgent implements Agent {
  role: Agent["role"] = "finance";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.deps.metrics.createCounter("finance_runs_total", "Total number of finance analyses");
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.finance", { sessionId: ctx.sessionId });
    const start = Date.now();
    try {
      this.deps.metrics.counter("finance_runs_total").inc();
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      const symbols = this.extractSymbols(ctx.text) || ["AAPL", "MSFT", "GOOG"];
      const userRole = ctx.userRole ?? "user";
      const perms = this.deps.permissions
        ? this.deps.permissions.getPermissions("finance_agent", workspaceId)
        : [];
      const market = await this.deps.tools.execute(
        "finance.get_market_data",
        { symbols: symbols.join(",") },
        { userRole, permissions: perms, workspaceId }
      );

      const holdings = symbols.map((s: string) => ({ symbol: s, qty: 10, price: 100 }));
      const optimization = await this.deps.tools.execute(
        "finance.optimize_portfolio",
        { holdings: JSON.stringify(holdings) },
        { userRole, permissions: perms, workspaceId }
      );

      return {
        text: JSON.stringify({ market, optimization }),
        meta: { agent: "finance", symbols },
      };
    } finally {
      const latency = (Date.now() - start) / 1000;
      this.deps.metrics.histogram("agent_latency_seconds").observe(latency);
      span.end();
    }
  }

  private extractSymbols(text: string): string[] | null {
    const match = text.match(/([A-Z]{2,5})(?:[, ]+([A-Z]{2,5}))*/);
    if (!match) return null;
    return match[0].split(/[, ]+/).filter(Boolean);
  }
}
