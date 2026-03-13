import type { AgentTracker, AgentObsEvent } from "../observability/agent-tracker.js";

export type ModelProfileRow = {
  model: string;
  runs: number;
  ok: number;
  fail: number;
  avgLatencyMs: number;
  avgTokens: number;
  avgToolCalls: number;
  avgCostUsd: number;
};

function modelKey(e: AgentObsEvent) {
  const m = typeof (e as any).model === "string" ? String((e as any).model) : "";
  return m.trim() ? m.trim() : "unknown";
}

export function profileModels(params: { tracker: AgentTracker; limit?: number }): ModelProfileRow[] {
  const events = params.tracker.listRecent({ limit: params.limit ?? 500 });
  const by: Record<
    string,
    {
      runs: number;
      ok: number;
      fail: number;
      avgLatencyMs: number;
      tokens: number;
      toolCalls: number;
      costUsd: number;
    }
  > = {};

  for (const e of events) {
    const k = modelKey(e);
    const cur =
      by[k] ??
      (by[k] = {
        runs: 0,
        ok: 0,
        fail: 0,
        avgLatencyMs: 0,
        tokens: 0,
        toolCalls: 0,
        costUsd: 0,
      });
    cur.runs += 1;
    if (e.ok) cur.ok += 1;
    else cur.fail += 1;
    cur.tokens += e.tokens.total;
    cur.toolCalls += e.toolCalls;
    cur.costUsd += e.costUsd;
    cur.avgLatencyMs += (e.latencyMs - cur.avgLatencyMs) / cur.runs;
  }

  return Object.entries(by)
    .map(([model, v]) => ({
      model,
      runs: v.runs,
      ok: v.ok,
      fail: v.fail,
      avgLatencyMs: v.avgLatencyMs,
      avgTokens: v.runs > 0 ? v.tokens / v.runs : 0,
      avgToolCalls: v.runs > 0 ? v.toolCalls / v.runs : 0,
      avgCostUsd: v.runs > 0 ? v.costUsd / v.runs : 0,
    }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 50);
}

