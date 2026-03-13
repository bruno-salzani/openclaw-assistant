import { randomUUID } from "node:crypto";
import type { EventBus } from "../infra/event-bus.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { AgentObsEvent } from "../observability/agent-tracker.js";
import type { EvolutionResult, EvolverTask } from "../evolver/types.js";
import { CodeAnalyzer } from "./code-analyzer.js";
import { PatchGenerator } from "./patch-generator.js";
import { PatchValidator } from "./patch-validator.js";

function normalizeThreshold(raw: unknown, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export class AutoRefactorService {
  private readonly analyzer: CodeAnalyzer;

  private readonly generator: PatchGenerator;

  private readonly validator = new PatchValidator();

  private running = false;

  private onObs: ((p: any) => void) | null = null;

  private obsBuffer: AgentObsEvent[] = [];

  constructor(
    private readonly deps: {
      repoRoot: string;
      metrics: MetricsRegistry;
      memory: MemorySystem;
      bus?: EventBus;
      llm?: LLMProvider;
    }
  ) {
    deps.metrics.createCounter(
      "self_improvement_auto_refactor_runs_total",
      "Total number of auto-refactor runs triggered by observability"
    );
    this.analyzer = new CodeAnalyzer({ repoRoot: deps.repoRoot, metrics: deps.metrics });
    this.generator = new PatchGenerator({ llm: deps.llm });
  }

  start() {
    if (!this.deps.bus) return;
    if (this.onObs) return;

    this.onObs = (evt: AgentObsEvent) => {
      if (!this.shouldTrigger(evt)) return;
      this.observe(evt);
    };
    this.deps.bus.on("ai.observability", this.onObs);
  }

  stop() {
    if (!this.deps.bus || !this.onObs) return;
    this.deps.bus.off("ai.observability", this.onObs);
    this.onObs = null;
  }

  observe(evt: AgentObsEvent) {
    this.obsBuffer.push(evt);
    const max = this.maxObsBufferSize();
    if (this.obsBuffer.length > max) this.obsBuffer.splice(0, this.obsBuffer.length - max);
  }

  async runOnce(input?: {
    mode?: "self_improvement" | "evolver";
    includeMetrics?: boolean;
    includeObserved?: boolean;
    maxTasks?: number;
    tasks?: EvolverTask[];
    apply?: boolean;
    commit?: boolean;
    runTests?: boolean;
    sandbox?: boolean;
    trigger?: Record<string, unknown>;
  }) {
    const mode = input?.mode === "evolver" ? "evolver" : "self_improvement";
    if (this.running) return { ok: false, error: "busy", mode };

    const now = Date.now();
    const includeMetrics = input?.includeMetrics !== false;
    const includeObserved =
      typeof input?.includeObserved === "boolean" ? input.includeObserved : mode === "self_improvement";
    const maxTasksRaw =
      typeof input?.maxTasks === "number"
        ? input.maxTasks
        : normalizeThreshold(process.env.IA_ASSISTANT_SELF_IMPROVEMENT_MAX_TASKS, 5);
    const maxTasks = Math.max(1, Math.min(25, Math.floor(maxTasksRaw)));

    const cfgFromEnv = this.resolveConfigFromEnv(mode);
    const apply = typeof input?.apply === "boolean" ? input.apply : cfgFromEnv.apply;
    const commit = typeof input?.commit === "boolean" ? input.commit : cfgFromEnv.commit;
    const sandbox = typeof input?.sandbox === "boolean" ? input.sandbox : cfgFromEnv.sandbox;
    const runTests =
      typeof input?.runTests === "boolean"
        ? input.runTests
        : cfgFromEnv.runTests && process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER === "1";

    const selected = await this.resolveTasks({
      mode,
      includeMetrics,
      includeObserved,
      maxTasks,
      explicitTasks: Array.isArray(input?.tasks) ? input?.tasks : undefined,
    });
    if (selected.tasks.length === 0) return { ok: true, mode, skipped: true, reason: "no_tasks" };

    const runId = randomUUID();
    const trigger = input?.trigger ?? { type: "manual" };
    const tasksForPayload = selected.tasks.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      filePath: t.filePath,
    }));

    this.deps.bus?.emit(`${mode}.start`, {
      runId,
      ts: now,
      trigger,
      config: { apply, commit, runTests, sandbox, maxTasks: tasksForPayload.length },
      tasks: tasksForPayload,
      ...(includeMetrics ? { signals: selected.signals } : {}),
    });

    this.running = true;
    this.deps.metrics.counter("self_improvement_auto_refactor_runs_total").inc();
    try {
      const results = await this.runCore({ mode, tasks: selected.tasks, apply, commit, runTests, sandbox });
      const accept = results.filter((r) => r.evaluation?.accept).length;
      const applied = results.filter((r) => r.applied).length;
      const committed = results.filter((r) => r.committed).length;

      const payload = {
        ok: true,
        runId,
        startedAt: now,
        durationMs: Date.now() - now,
        summary: { accept, applied, committed },
        tasks: tasksForPayload,
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
        ...(includeMetrics ? { signals: selected.signals } : {}),
      };

      this.deps.bus?.emit(`${mode}.result`, payload);
      await this.deps.memory.add("meta", JSON.stringify(payload), {
        type: mode === "evolver" ? "self_improvement" : "self_improvement_auto_refactor",
        runId,
        startedAt: now,
      });
      this.deps.metrics.counter("learning_iterations_total").inc();
      return payload;
    } finally {
      this.running = false;
    }
  }

  private shouldTrigger(evt: AgentObsEvent) {
    if (!evt.ok) return true;

    const latencyThresholdMs = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_LATENCY_MS_THRESHOLD,
      2500
    );
    const tokensThreshold = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOKENS_THRESHOLD,
      8000
    );
    const toolCallsThreshold = normalizeThreshold(
      process.env.IA_ASSISTANT_SELF_IMPROVEMENT_AGENT_TOOL_CALLS_THRESHOLD,
      15
    );

    if (evt.latencyMs >= latencyThresholdMs) return true;
    if (evt.tokens.total >= tokensThreshold) return true;
    if (evt.toolCalls >= toolCallsThreshold) return true;
    return false;
  }

  private mergeTasks(tasks: EvolverTask[]) {
    const seen = new Set<string>();
    const out: EvolverTask[] = [];
    for (const t of tasks) {
      const key = `${t.type}:${t.filePath ?? ""}:${t.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    const prioScore = (p: EvolverTask["priority"]) => (p === "high" ? 3 : p === "medium" ? 2 : 1);
    return out.sort((a, b) => prioScore(b.priority) - prioScore(a.priority));
  }

  private maxObsBufferSize() {
    const v = Number(process.env.IA_ASSISTANT_SELF_IMPROVEMENT_OBS_BUFFER ?? 50);
    if (!Number.isFinite(v) || v <= 0) return 50;
    return Math.max(1, Math.min(500, Math.floor(v)));
  }

  private resolveConfigFromEnv(mode: "self_improvement" | "evolver") {
    if (mode === "evolver") {
      const apply = process.env.IA_ASSISTANT_EVOLVER_APPLY === "1";
      const commit = process.env.IA_ASSISTANT_EVOLVER_COMMIT === "1";
      const runTests = process.env.IA_ASSISTANT_EVOLVER_RUN_TESTS !== "0";
      const sandbox = process.env.IA_ASSISTANT_EVOLVER_SANDBOX === "1";
      return { apply, commit, runTests, sandbox };
    }

    const apply = process.env.IA_ASSISTANT_SELF_IMPROVEMENT_APPLY === "1";
    const commit = process.env.IA_ASSISTANT_SELF_IMPROVEMENT_COMMIT === "1";
    const runTests = process.env.IA_ASSISTANT_SELF_IMPROVEMENT_RUN_TESTS !== "0";
    const sandbox = process.env.IA_ASSISTANT_SELF_IMPROVEMENT_SANDBOX === "1";
    return { apply, commit, runTests, sandbox };
  }

  private async resolveTasks(params: {
    mode: "self_improvement" | "evolver";
    includeMetrics: boolean;
    includeObserved: boolean;
    maxTasks: number;
    explicitTasks?: EvolverTask[];
  }): Promise<{ tasks: EvolverTask[]; signals: unknown }> {
    const explicit = Array.isArray(params.explicitTasks) ? params.explicitTasks : null;
    if (explicit && explicit.length > 0) {
      return { tasks: explicit.slice(0, params.maxTasks), signals: null };
    }

    const tasks: EvolverTask[] = [];
    let signals: unknown = null;

    if (params.includeObserved) {
      const obs = this.drainObsBuffer();
      for (const evt of obs) tasks.push(...this.analyzer.analyzeAiObservability(evt));
    }

    const metricSampleEnabled =
      params.mode === "evolver" ? true : process.env.IA_ASSISTANT_SELF_IMPROVEMENT_USE_METRICS !== "0";
    if (params.includeMetrics && metricSampleEnabled) {
      const out = await this.analyzer.analyzeMetrics();
      signals = out.signals;
      tasks.push(...out.tasks);
    }

    const merged = this.mergeTasks(tasks);
    return { tasks: merged.slice(0, params.maxTasks), signals };
  }

  private drainObsBuffer() {
    const out = this.obsBuffer.slice();
    this.obsBuffer = [];
    return out;
  }

  private async runCore(params: {
    mode: "self_improvement" | "evolver";
    tasks: EvolverTask[];
    apply: boolean;
    commit: boolean;
    runTests: boolean;
    sandbox: boolean;
  }): Promise<EvolutionResult[]> {
    const analysis = this.generator.analyzeRepo(this.deps.repoRoot);
    const results: EvolutionResult[] = [];
    const patches = await this.generator.generateForTasks({
      analysis,
      tasks: params.tasks,
      limit: Math.min(10, params.tasks.length),
    });

    const byTask = new Map(patches.map((p) => [p.task.id, p.patch]));
    for (const task of params.tasks) {
      const patch = byTask.get(task.id);
      const result: EvolutionResult = { task };
      if (!patch) {
        results.push(result);
        continue;
      }
      result.patch = patch;
      this.deps.bus?.emit(`${params.mode}.patch.generated`, {
        taskId: task.id,
        title: patch.title,
        filesTouched: patch.filesTouched,
      });

      const v = this.validator.validateAndOptionallyApply({
        repoRoot: this.deps.repoRoot,
        patch,
        apply: params.apply,
        commit: params.commit,
        runTests: params.runTests,
        sandbox: params.sandbox,
      });
      result.review = v.review;
      result.tests = v.tests;
      result.bench = v.bench;
      result.evaluation = v.evaluation;
      result.applied = v.applied;
      result.committed = v.committed;

      this.deps.bus?.emit(`${params.mode}.patch.validated`, {
        taskId: task.id,
        ok: v.ok,
        review: v.review,
        evaluation: v.evaluation,
        applied: v.applied,
        committed: v.committed,
        errors: v.errors,
      });

      results.push(result);
    }
    return results;
  }
}
