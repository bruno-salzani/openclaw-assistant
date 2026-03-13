export type RunMetrics = {
  successRate: number;
  avgLatencyMs: number;
  avgOutputChars: number;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function computeRunMetrics(results: Array<{ ok: boolean; latencyMs: number; outputChars: number }>): RunMetrics {
  const total = results.length || 1;
  const okCount = results.filter((r) => r.ok).length;
  const avgLatencyMs = results.reduce((a, r) => a + (Number(r.latencyMs) || 0), 0) / total;
  const avgOutputChars = results.reduce((a, r) => a + (Number(r.outputChars) || 0), 0) / total;
  return { successRate: clamp01(okCount / total), avgLatencyMs, avgOutputChars };
}

