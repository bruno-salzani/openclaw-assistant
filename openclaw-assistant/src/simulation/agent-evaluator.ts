import type { RunMetrics } from "./metrics-engine.js";

export type AgentScore = {
  score: number;
  breakdown: Record<string, number>;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function evaluateAgent(params: {
  metrics: RunMetrics;
  hallucinationRate?: number;
  avgTokenCostUsd?: number;
}) {
  const hallucinationPenalty = clamp01(Number(params.hallucinationRate ?? 0));
  const costPenalty = clamp01(Number(params.avgTokenCostUsd ?? 0) / 0.05);
  const latencyScore = clamp01(1 - Math.min(1, params.metrics.avgLatencyMs / 5000));
  const costScore = clamp01(1 - costPenalty);

  const breakdown = {
    success_rate: clamp01(params.metrics.successRate),
    latency_score: latencyScore,
    cost_score: costScore,
    hallucination_penalty: hallucinationPenalty,
  };
  const score =
    breakdown.success_rate * 0.5 +
    breakdown.latency_score * 0.2 +
    breakdown.cost_score * 0.2 +
    (1 - breakdown.hallucination_penalty) * 0.1;

  return { score: clamp01(score), breakdown } satisfies AgentScore;
}

