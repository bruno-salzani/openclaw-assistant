import type { Agent, AgentContext, AgentResult } from "../types.js";
import type { AgentDeps } from "../agent-deps.js";

export class DocumentAgent implements Agent {
  role: Agent["role"] = "document";

  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  async handle(ctx: AgentContext): Promise<AgentResult> {
    if (this.deps.aiObs)
      return this.deps.aiObs.trackAgent("document", ctx, async () => this.handleInner(ctx));
    return this.handleInner(ctx);
  }

  private async handleInner(ctx: AgentContext): Promise<AgentResult> {
    const span = this.deps.tracer.startSpan("agent.document", { sessionId: ctx.sessionId });
    try {
      const workspaceId =
        typeof (ctx.metadata as any)?.workspaceId === "string"
          ? String((ctx.metadata as any).workspaceId)
          : undefined;
      const traceId =
        typeof (ctx.metadata as any)?.traceId === "string"
          ? String((ctx.metadata as any).traceId)
          : undefined;
      const file = String((ctx.metadata as any)?.file ?? "");
      const userRole = ctx.userRole ?? "user";
      const perms = this.deps.permissions
        ? this.deps.permissions.getPermissions("document_agent", workspaceId)
        : [];
      const content = file
        ? await this.deps.tools.execute(
            "filesystem.read_file",
            { path: file },
            {
              userRole,
              permissions: perms,
              sandbox: true,
              workspaceId,
              traceId,
              source: "agent.document",
            }
          )
        : { ok: true, content: "" };
      const text =
        typeof content === "object" && content && "content" in content
          ? String((content as any).content)
          : "";
      const extracted = {
        vendor: text.match(/vendor[:\s]+(\w+)/i)?.[1] ?? null,
        amount: text.match(/amount[:\s]+([\d.]+)/i)?.[1] ?? null,
        currency: text.match(/currency[:\s]+([A-Z]{3})/i)?.[1] ?? null,
      };
      if (this.deps.llm && process.env.IA_ASSISTANT_LLM_DOCUMENT === "1" && text.trim()) {
        try {
          const out = await this.deps.llm.chat({
            messages: [
              {
                role: "system",
                content:
                  'Extraia campos estruturados de um documento. Responda APENAS JSON válido no formato {"vendor":string|null,"amount":string|null,"currency":string|null}.',
              },
              { role: "user", content: text.slice(0, 30_000) },
            ],
            temperature: 0,
            maxTokens: 300,
          });
          const parsed = JSON.parse(out) as any;
          const next = {
            vendor: typeof parsed?.vendor === "string" ? parsed.vendor : null,
            amount: typeof parsed?.amount === "string" ? parsed.amount : null,
            currency: typeof parsed?.currency === "string" ? parsed.currency : null,
          };
          return { text: JSON.stringify({ extracted: next }) };
        } catch {}
      }
      return { text: JSON.stringify({ extracted }) };
    } finally {
      span.end();
    }
  }
}
