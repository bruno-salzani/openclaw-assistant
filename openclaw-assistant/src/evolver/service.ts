import type { MetricsRegistry } from "../observability/metrics.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { EventBus } from "../infra/event-bus.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { AutoRefactorService } from "../self-improvement/auto-refactor.js";
import { EvolutionLoop } from "./loop.js";
import { FailureDetector, buildEvolverTasksFromSignals } from "./failure-detector.js";

export class EvolverService {
  private readonly detector: FailureDetector;

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  constructor(
    private readonly deps: {
      repoRoot: string;
      metrics: MetricsRegistry;
      memory: MemorySystem;
      bus?: EventBus;
      llm?: LLMProvider;
      selfImprovement?: AutoRefactorService;
    }
  ) {
    this.detector = new FailureDetector(deps.metrics);
  }

  start() {
    const enabled = process.env.IA_ASSISTANT_EVOLVER_ENABLE === "1";
    if (!enabled) return;
    if (this.timer) return;
    const intervalMs = Number(process.env.IA_ASSISTANT_EVOLVER_INTERVAL_MS ?? 60_000);
    const ms = Number.isFinite(intervalMs) ? Math.max(5_000, intervalMs) : 60_000;
    this.timer = setInterval(() => {
      this.tick().catch(() => undefined);
    }, ms);
    if (typeof (this.timer as any).unref === "function") (this.timer as any).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      if (this.deps.selfImprovement) {
        const apply = process.env.IA_ASSISTANT_EVOLVER_APPLY === "1";
        const commit = process.env.IA_ASSISTANT_EVOLVER_COMMIT === "1";
        const runTests =
          process.env.IA_ASSISTANT_EVOLVER_RUN_TESTS !== "0" &&
          process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER === "1";
        const sandbox = process.env.IA_ASSISTANT_EVOLVER_SANDBOX === "1";
        const includeObserved = process.env.IA_ASSISTANT_EVOLVER_INCLUDE_AI_OBS !== "0";

        await this.deps.selfImprovement.runOnce({
          mode: "evolver",
          includeMetrics: true,
          includeObserved,
          apply,
          commit,
          runTests,
          sandbox,
          trigger: { type: "evolver.tick" },
        });
        return;
      }

      const signals = await this.detector.sample();
      const tasks = buildEvolverTasksFromSignals({ repoRoot: this.deps.repoRoot, signals });
      if (tasks.length === 0) return;

      const apply = process.env.IA_ASSISTANT_EVOLVER_APPLY === "1";
      const commit = process.env.IA_ASSISTANT_EVOLVER_COMMIT === "1";
      const runTests =
        process.env.IA_ASSISTANT_EVOLVER_RUN_TESTS !== "0" &&
        process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER === "1";

      this.deps.bus?.emit("evolver.start", { tasks, signals });
      const loop = new EvolutionLoop();
      const results = await loop.runOnce({
        repoRoot: this.deps.repoRoot,
        apply,
        commit,
        runTests,
        llm: this.deps.llm,
        tasks,
      });

      const accept = results.filter((r) => r.evaluation?.accept).length;
      const applied = results.filter((r) => r.applied).length;
      const committed = results.filter((r) => r.committed).length;
      const payload = {
        ok: true,
        startedAt,
        durationMs: Date.now() - startedAt,
        tasks: tasks.map((t) => ({ id: t.id, type: t.type, title: t.title, filePath: t.filePath })),
        summary: { accept, applied, committed },
        results: results.map((r) => ({
          id: r.task.id,
          type: r.task.type,
          title: r.task.title,
          patchTitle: r.patch?.title,
          review: r.review,
          evaluation: r.evaluation,
          applied: r.applied ?? false,
          committed: r.committed ?? false,
          testsOk: r.tests?.ok,
        })),
      };
      this.deps.bus?.emit("evolver.result", payload);
      await this.deps.memory.add("meta", JSON.stringify(payload), {
        type: "self_improvement",
        startedAt,
      });
      this.deps.metrics.counter("learning_iterations_total").inc();
    } finally {
      this.running = false;
    }
  }
}
