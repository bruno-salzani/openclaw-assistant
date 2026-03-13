import type { EventBus } from "../../infra/event-bus.js";
import type { MemorySystem } from "../../memory/memory-system.js";

export type ToolExecutionSample = {
  tool: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  traceId?: string;
  workspaceId?: string;
  source?: string;
  costUsd?: number;
  ts: number;
};

export type ToolProfile = {
  tool: string;
  calls: number;
  success: number;
  errors: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  lastError?: string;
  lastSeenAt: number;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function p95(values: number[]) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const idx = Math.max(0, Math.min(xs.length - 1, Math.floor(xs.length * 0.95) - 1));
  return xs[idx] ?? xs[xs.length - 1] ?? 0;
}

type MutableProfile = {
  tool: string;
  calls: number;
  success: number;
  errors: number;
  avgLatencyMs: number;
  latencies: number[];
  costSumUsd: number;
  lastError?: string;
  lastSeenAt: number;
};

export class ToolProfiler {
  private readonly byTool = new Map<string, MutableProfile>();

  private flushAtByTool = new Map<string, number>();

  constructor(
    private readonly deps: {
      bus: EventBus;
      memory?: MemorySystem;
    },
    private readonly config: {
      latencyWindow: number;
      flushEveryMs: number;
    } = { latencyWindow: 120, flushEveryMs: 60_000 }
  ) {}

  start() {
    this.deps.bus.on("tool.executed", (evt: any) => {
      const sample: ToolExecutionSample = {
        tool: String(evt?.tool ?? ""),
        ok: Boolean(evt?.ok),
        durationMs: Number(evt?.durationMs ?? 0),
        error: typeof evt?.error === "string" ? String(evt.error) : undefined,
        traceId: typeof evt?.traceId === "string" ? String(evt.traceId) : undefined,
        workspaceId: typeof evt?.workspaceId === "string" ? String(evt.workspaceId) : undefined,
        source: typeof evt?.source === "string" ? String(evt.source) : undefined,
        costUsd: Number.isFinite(evt?.costUsd) ? Number(evt.costUsd) : undefined,
        ts: typeof evt?.ts === "number" ? Number(evt.ts) : Date.now(),
      };
      if (!sample.tool) return;
      this.observe(sample).catch(() => undefined);
    });
  }

  getProfile(tool: string): ToolProfile | null {
    const p = this.byTool.get(String(tool));
    if (!p) return null;
    const calls = p.calls || 0;
    const successRate = calls ? clamp01(p.success / calls) : 0;
    const errorRate = calls ? clamp01(p.errors / calls) : 0;
    const p95LatencyMs = p95(p.latencies);
    const avgCostUsd = calls ? p.costSumUsd / calls : 0;
    return {
      tool: p.tool,
      calls,
      success: p.success,
      errors: p.errors,
      successRate,
      errorRate,
      avgLatencyMs: p.avgLatencyMs,
      p95LatencyMs,
      avgCostUsd,
      lastError: p.lastError,
      lastSeenAt: p.lastSeenAt,
    };
  }

  snapshot(params?: { limit?: number }) {
    const all = [...this.byTool.keys()]
      .map((k) => this.getProfile(k))
      .filter(Boolean) as ToolProfile[];
    all.sort((a, b) => b.calls - a.calls);
    const limit = typeof params?.limit === "number" ? Math.max(1, Math.min(500, params.limit)) : 200;
    return all.slice(0, limit);
  }

  private async observe(sample: ToolExecutionSample) {
    const now = sample.ts;
    const key = sample.tool;
    const prev =
      this.byTool.get(key) ??
      ({
        tool: key,
        calls: 0,
        success: 0,
        errors: 0,
        avgLatencyMs: 0,
        latencies: [],
        costSumUsd: 0,
        lastSeenAt: now,
      } satisfies MutableProfile);

    prev.calls += 1;
    if (sample.ok) prev.success += 1;
    else prev.errors += 1;
    if (!sample.ok && sample.error) prev.lastError = sample.error.slice(0, 400);
    prev.lastSeenAt = now;

    const d = Number.isFinite(sample.durationMs) ? Math.max(0, sample.durationMs) : 0;
    const alpha = 0.12;
    prev.avgLatencyMs = prev.calls === 1 ? d : prev.avgLatencyMs * (1 - alpha) + d * alpha;
    prev.latencies.push(d);
    const win = Math.max(20, Math.min(500, Number(this.config.latencyWindow)));
    if (prev.latencies.length > win) prev.latencies.splice(0, prev.latencies.length - win);

    if (Number.isFinite(sample.costUsd)) prev.costSumUsd += Number(sample.costUsd);

    this.byTool.set(key, prev);

    const flushEveryMs = Math.max(5_000, Number(this.config.flushEveryMs));
    const nextFlushAt = this.flushAtByTool.get(key) ?? 0;
    if (this.deps.memory && now >= nextFlushAt) {
      this.flushAtByTool.set(key, now + flushEveryMs);
      const profile = this.getProfile(key);
      if (profile) await this.deps.memory.add("event", "tool_profile", profile as any);
    }
  }
}

