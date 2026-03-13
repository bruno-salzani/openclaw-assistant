import type { ExperienceEvent } from "./experience-collector.js";

export type TrainingExample = {
  type: "tool_failure" | "agent_failure" | "debate_loss" | "user_correction";
  input: string;
  output?: string;
  target?: string;
  meta?: Record<string, unknown>;
};

function safe(v: unknown, max = 5000) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) : s;
}

export function analyzeExperiences(events: ExperienceEvent[]) {
  const examples: TrainingExample[] = [];
  const counters: Record<string, number> = {};

  for (const e of events) {
    counters[e.type] = (counters[e.type] ?? 0) + 1;
    if (e.type === "tool_failure") {
      examples.push({
        type: "tool_failure",
        input: safe({ tool: e.tool, source: e.source, traceId: e.traceId }),
        target: safe({ error: e.error, durationMs: e.durationMs }),
        meta: { workspaceId: e.workspaceId, ts: e.ts },
      });
    } else if (e.type === "agent_failure") {
      examples.push({
        type: "agent_failure",
        input: safe({ agent: e.agent, sessionId: e.sessionId, traceId: e.traceId }),
        target: safe({ latencyMs: e.latencyMs, toolCalls: e.toolCalls, tokensTotal: e.tokensTotal }),
        meta: { costUsd: e.costUsd, ts: e.ts },
      });
    } else if (e.type === "debate_loss") {
      examples.push({
        type: "debate_loss",
        input: safe({ winnerId: e.winnerId, loserId: e.loserId, traceId: e.traceId }),
        target: safe({ scores: e.scores }),
        meta: { sessionId: e.sessionId, ts: e.ts },
      });
    } else if (e.type === "user_correction") {
      examples.push({
        type: "user_correction",
        input: safe(e.prompt, 8000),
        output: safe(e.answer, 8000),
        target: safe(e.correction, 8000),
        meta: { sessionId: e.sessionId, userId: e.userId, traceId: e.traceId, ts: e.ts },
      });
    }
  }

  return { ok: true, counters, examples };
}

