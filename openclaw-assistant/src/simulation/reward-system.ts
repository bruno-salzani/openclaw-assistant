export type RewardSignal = {
  reward: number;
  reasons: string[];
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function computeReward(params: {
  ok: boolean;
  latencyMs?: number;
  tokens?: number;
  toolSuccessRate?: number;
}): RewardSignal {
  const reasons: string[] = [];
  let r = params.ok ? 1 : -1;
  if (!params.ok) reasons.push("failed");
  const latency = Number(params.latencyMs ?? 0);
  if (Number.isFinite(latency) && latency > 0) r += clamp(1 - latency / 10_000, -0.5, 0.5);
  const tokens = Number(params.tokens ?? 0);
  if (Number.isFinite(tokens) && tokens > 0) r += clamp(1 - tokens / 8000, -0.3, 0.3);
  const tsr = Number(params.toolSuccessRate ?? 1);
  if (Number.isFinite(tsr)) r += clamp(tsr - 0.8, -0.3, 0.3);
  return { reward: clamp(r, -2, 2), reasons };
}

