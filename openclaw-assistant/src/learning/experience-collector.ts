import fs from "node:fs";
import path from "node:path";
import type { EventBus } from "../infra/event-bus.js";

export type ExperienceEvent =
  | {
      type: "tool_failure";
      tool: string;
      error?: string;
      durationMs?: number;
      traceId?: string;
      workspaceId?: string;
      source?: string;
      ts: number;
      meta?: Record<string, unknown>;
    }
  | {
      type: "agent_failure";
      agent: string;
      sessionId?: string;
      traceId?: string;
      latencyMs?: number;
      toolCalls?: number;
      tokensTotal?: number;
      costUsd?: number;
      ts: number;
      meta?: Record<string, unknown>;
    }
  | {
      type: "debate_loss";
      traceId?: string;
      sessionId?: string;
      winnerId: string;
      loserId: string;
      scores?: Array<{ proposalId: string; score: number }>;
      ts: number;
      meta?: Record<string, unknown>;
    }
  | {
      type: "user_correction";
      sessionId?: string;
      userId?: string;
      traceId?: string;
      prompt: string;
      answer: string;
      correction: string;
      ts: number;
      meta?: Record<string, unknown>;
    };

export class ExperienceCollector {
  private readonly filePath: string;

  constructor(
    private readonly deps: {
      bus: EventBus;
      baseDir?: string;
    }
  ) {
    const baseDir = deps.baseDir ?? process.cwd();
    this.filePath = path.join(baseDir, ".ia-assistant", "learning", "experiences.jsonl");
  }

  start() {
    this.deps.bus.on("tool.executed", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      if (evt.ok === true) return;
      const e: ExperienceEvent = {
        type: "tool_failure",
        tool: String(evt.tool ?? ""),
        error: typeof evt.error === "string" ? String(evt.error) : undefined,
        durationMs: Number.isFinite(evt.durationMs) ? Number(evt.durationMs) : undefined,
        traceId: typeof evt.traceId === "string" ? String(evt.traceId) : undefined,
        workspaceId: typeof evt.workspaceId === "string" ? String(evt.workspaceId) : undefined,
        source: typeof evt.source === "string" ? String(evt.source) : undefined,
        ts: typeof evt.ts === "number" ? Number(evt.ts) : Date.now(),
      };
      if (!e.tool) return;
      this.append(e);
    });

    this.deps.bus.on("ai.observability", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      if (evt.ok === true) return;
      const e: ExperienceEvent = {
        type: "agent_failure",
        agent: String(evt.agent ?? ""),
        sessionId: typeof evt.sessionId === "string" ? String(evt.sessionId) : undefined,
        traceId: typeof evt.traceId === "string" ? String(evt.traceId) : undefined,
        latencyMs: Number.isFinite(evt.latencyMs) ? Number(evt.latencyMs) : undefined,
        toolCalls: Number.isFinite(evt.toolCalls) ? Number(evt.toolCalls) : undefined,
        tokensTotal: Number.isFinite(evt.tokens?.total) ? Number(evt.tokens.total) : undefined,
        costUsd: Number.isFinite(evt.costUsd) ? Number(evt.costUsd) : undefined,
        ts: Date.now(),
      };
      if (!e.agent) return;
      this.append(e);
    });

    this.deps.bus.on("policy.deny", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      const tool = typeof evt.tool === "string" ? String(evt.tool) : "";
      if (!tool) return;
      const e: ExperienceEvent = {
        type: "tool_failure",
        tool,
        error: typeof evt.reason === "string" ? String(evt.reason) : "policy.deny",
        durationMs: undefined,
        traceId: typeof evt.traceId === "string" ? String(evt.traceId) : undefined,
        workspaceId: typeof evt.workspaceId === "string" ? String(evt.workspaceId) : undefined,
        source: "policy",
        ts: Date.now(),
        meta: { input: evt.input },
      };
      this.append(e);
    });

    this.deps.bus.on("reasoning.debate", (evt: any) => {
      if (!evt || typeof evt !== "object") return;
      const proposals = Array.isArray(evt.proposals) ? evt.proposals : [];
      const winnerId = typeof evt.winnerId === "string" ? String(evt.winnerId) : "";
      if (!winnerId || proposals.length < 2) return;
      const losers = proposals
        .map((p: any) => String(p?.id ?? ""))
        .filter(Boolean)
        .filter((id: string) => id !== winnerId);
      if (losers.length === 0) return;
      for (const loserId of losers) {
        const e: ExperienceEvent = {
          type: "debate_loss",
          traceId: typeof evt.traceId === "string" ? String(evt.traceId) : undefined,
          sessionId: typeof evt.sessionId === "string" ? String(evt.sessionId) : undefined,
          winnerId,
          loserId,
          scores: Array.isArray(evt.scores)
            ? evt.scores
                .map((s: any) => ({
                  proposalId: String(s?.proposalId ?? ""),
                  score: Number(s?.score ?? 0),
                }))
                .filter((s: any) => Boolean(s.proposalId))
            : undefined,
          ts: Date.now(),
        };
        this.append(e);
      }
    });
  }

  recordUserCorrection(input: {
    sessionId?: string;
    userId?: string;
    traceId?: string;
    prompt: string;
    answer: string;
    correction: string;
    meta?: Record<string, unknown>;
  }) {
    const e: ExperienceEvent = {
      type: "user_correction",
      sessionId: input.sessionId,
      userId: input.userId,
      traceId: input.traceId,
      prompt: String(input.prompt ?? ""),
      answer: String(input.answer ?? ""),
      correction: String(input.correction ?? ""),
      ts: Date.now(),
      meta: input.meta,
    };
    if (!e.prompt.trim() || !e.correction.trim()) return null;
    this.append(e);
    return e;
  }

  append(e: ExperienceEvent) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(e)}\n`);
  }

  readAll(limit = 10_000): ExperienceEvent[] {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const lines = raw.split(/\r?\n/g).filter((l) => l.trim().length > 0).slice(-limit);
      return lines
        .map((l) => {
          try {
            return JSON.parse(l) as ExperienceEvent;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as ExperienceEvent[];
    } catch {
      return [];
    }
  }
}
