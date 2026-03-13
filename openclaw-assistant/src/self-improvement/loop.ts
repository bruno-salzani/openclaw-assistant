import type { AutoRefactorService } from "./auto-refactor.js";
import type { EpisodeStore } from "../memory/episodic/episode-store.js";

export class SelfImprovementLoop {
  constructor(
    private readonly deps: {
      service: AutoRefactorService;
      episodes: EpisodeStore;
    }
  ) {}

  async run(params?: {
    iterations?: number;
    includeMetrics?: boolean;
    includeObserved?: boolean;
    maxTasks?: number;
    apply?: boolean;
    commit?: boolean;
    runTests?: boolean;
    sandbox?: boolean;
    stopOnNoTasks?: boolean;
  }) {
    const iters = typeof params?.iterations === "number" ? Math.max(1, Math.min(10, params.iterations)) : 3;
    const stopOnNoTasks = params?.stopOnNoTasks !== false;
    const results: any[] = [];

    for (let i = 0; i < iters; i += 1) {
      const out = (await this.deps.service.runOnce({
        mode: "self_improvement",
        includeMetrics: typeof params?.includeMetrics === "boolean" ? params.includeMetrics : undefined,
        includeObserved: typeof params?.includeObserved === "boolean" ? params.includeObserved : undefined,
        ...(typeof params?.maxTasks === "number" ? { maxTasks: params.maxTasks } : {}),
        ...(typeof params?.apply === "boolean" ? { apply: params.apply } : {}),
        ...(typeof params?.commit === "boolean" ? { commit: params.commit } : {}),
        ...(typeof params?.runTests === "boolean" ? { runTests: params.runTests } : {}),
        ...(typeof params?.sandbox === "boolean" ? { sandbox: params.sandbox } : {}),
        trigger: { type: "gateway.loop", iteration: i + 1, total: iters },
      })) as any;
      results.push(out);
      if (stopOnNoTasks && Boolean(out?.skipped) && String(out?.reason ?? "") === "no_tasks") break;
      if (out?.ok === false && String(out?.error ?? "") === "busy") break;
    }

    const accepted = results
      .flatMap((r: any) => (Array.isArray(r?.results) ? r.results : []))
      .filter((r: any) => Boolean(r?.evaluation?.accept)).length;
    const applied = results.flatMap((r: any) => (Array.isArray(r?.results) ? r.results : [])).filter((r: any) => r?.applied)
      .length;
    const committed = results
      .flatMap((r: any) => (Array.isArray(r?.results) ? r.results : []))
      .filter((r: any) => r?.committed).length;

    await this.deps.episodes.record({
      kind: "self_improvement_loop",
      objective: "self_improvement",
      ok: true,
      score: accepted > 0 ? 1 : 0.5,
      result: { iterations: results.length, accepted, applied, committed },
    });

    return { ok: true, iterations: results.length, accepted, applied, committed, results };
  }
}
