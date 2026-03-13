import type { MemorySystem } from "../../memory/memory-system.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import { SelfCritic } from "./self-critic.js";

export type ImprovementLoopResult = {
  ok: boolean;
  final: string;
  iterations: number;
  lastScore: number;
  critiques: Array<{ score: number; critique: string }>;
};

function readNumEnv(key: string, fallback: number) {
  const v = Number(process.env[key] ?? fallback);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export class ImprovementLoop {
  private readonly critic: SelfCritic;

  constructor(
    private readonly deps: {
      llm?: LLMProvider;
      memory?: MemorySystem;
    }
  ) {
    this.critic = new SelfCritic({ llm: deps.llm });
  }

  async run(params: { prompt: string; answer: string; traceId?: string; sessionId?: string; userId?: string }) {
    const enabled = process.env.IA_ASSISTANT_SELF_REFLECTION_ENABLE === "1" && Boolean(this.deps.llm);
    if (!enabled) {
      return {
        ok: Boolean(String(params.answer ?? "").trim()),
        final: String(params.answer ?? ""),
        iterations: 0,
        lastScore: 1,
        critiques: [],
      } satisfies ImprovementLoopResult;
    }

    const threshold = clamp(readNumEnv("IA_ASSISTANT_SELF_REFLECTION_THRESHOLD", 0.75), 0, 1);
    const maxIters = clamp(readNumEnv("IA_ASSISTANT_SELF_REFLECTION_MAX_ITERS", 2), 0, 5);
    let current = String(params.answer ?? "");
    const critiques: Array<{ score: number; critique: string }> = [];
    let lastScore = 0;

    for (let i = 0; i < maxIters; i += 1) {
      const r = await this.critic.evaluate({ prompt: params.prompt, answer: current });
      lastScore = r.score;
      critiques.push({ score: r.score, critique: r.critique });
      if (r.score >= threshold) break;
      current = r.improved;
    }

    if (this.deps.memory) {
      try {
        await this.deps.memory.add("meta", JSON.stringify({ critiques, lastScore, threshold }), {
          type: "self_reflection",
          traceId: params.traceId,
          sessionId: params.sessionId,
          userId: params.userId,
        });
      } catch {}
    }

    return {
      ok: Boolean(current.trim()),
      final: current,
      iterations: critiques.length,
      lastScore,
      critiques,
    } satisfies ImprovementLoopResult;
  }
}

