import type { ToolProfile } from "./tool-profiler.js";
import { rankTools, type ToolScore } from "./tool-ranking.js";

function norm(s: string) {
  return String(s ?? "").toLowerCase();
}

export function recommendTools(params: {
  profiles: ToolProfile[];
  candidates?: string[];
  query?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(50, Number(params.limit ?? 5)));
  const query = norm(params.query ?? "");

  const candidateSet = Array.isArray(params.candidates)
    ? new Set(params.candidates.map(String).filter(Boolean))
    : null;

  const filtered = params.profiles.filter((p) => {
    if (candidateSet && !candidateSet.has(p.tool)) return false;
    if (!query) return true;
    return norm(p.tool).includes(query);
  });

  const ranked = rankTools(filtered).slice(0, limit);
  const best = ranked[0]?.tool ?? null;

  return {
    ok: true,
    best,
    ranked: ranked.map((r: ToolScore) => ({
      tool: r.tool,
      score: r.score,
      successRate: r.profile.successRate,
      p95LatencyMs: r.profile.p95LatencyMs,
      calls: r.profile.calls,
    })),
  };
}

