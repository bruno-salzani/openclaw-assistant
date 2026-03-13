import type { AutonomousAgent } from "../types.js";

export function buildSecurityAgent(): AutonomousAgent {
  const windowMs = 5 * 60_000;
  const threshold = Number(process.env.IA_ASSISTANT_AUTONOMOUS_SECURITY_TOOL_ERROR_THRESHOLD ?? 10);
  const recent: number[] = [];

  return {
    id: "security_agent",
    description: "Monitora erros e cria sinais/relatórios de segurança operacionais",
    triggers: [
      { kind: "event", topic: "tool.error" },
      { kind: "cron", expression: "0 * * * *" },
    ],
    run: async (deps, ctx) => {
      const now = Date.now();
      const workspaceId = ctx.workspaceId;
      if (ctx.trigger.kind === "event") {
        recent.push(now);
        while (recent.length > 0 && recent[0] && now - recent[0] > windowMs) recent.shift();
        const count = recent.length;
        if (count >= threshold) {
          deps.bus?.emit("autonomous.security.alert", {
            count,
            windowMs,
            threshold,
          });
          await deps.memory.add("event", "security_agent_alert_tool_errors", {
            count,
            windowMs,
            threshold,
            workspaceId,
          });
        }
        return;
      }

      const raw = await deps.metrics.prometheus();
      deps.bus?.emit("autonomous.security.report", { ok: true, ts: now });
      await deps.memory.add("meta", String(raw), {
        type: "security_report",
        workspaceId,
        ts: now,
      });
    },
  };
}

