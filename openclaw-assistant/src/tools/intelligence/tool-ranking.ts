import type { ToolProfile } from "./tool-profiler.js";

export type ToolScore = {
  tool: string;
  score: number;
  breakdown: {
    success: number;
    latency: number;
    cost: number;
    stability: number;
  };
  profile: ToolProfile;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function scoreTool(profile: ToolProfile) {
  const success = clamp01(profile.successRate);
  const stability = clamp01(1 - profile.errorRate);
  const latency = clamp01(1 - Math.min(1, profile.p95LatencyMs / 10_000));
  const cost = clamp01(1 - Math.min(1, profile.avgCostUsd / 0.05));

  const score = success * 0.55 + stability * 0.15 + latency * 0.25 + cost * 0.05;
  return {
    tool: profile.tool,
    score,
    breakdown: { success, stability, latency, cost },
    profile,
  } satisfies ToolScore;
}

export function rankTools(profiles: ToolProfile[]) {
  const scored = profiles.map(scoreTool);
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

