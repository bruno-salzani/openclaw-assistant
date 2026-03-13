import type { AgentDeps } from "../agents/agent-deps.js";
import type { TaskWorkerPool } from "../tasks/worker-pool.js";
import { WorkerAutoscaler } from "../tasks/autoscaler.js";
import { GoalDiscoveryEngine } from "./goal-discovery.js";
import { KnowledgeMesh } from "../infra/knowledge-mesh.js";
import { AutoRemediator } from "../automations/auto-remediation.js";
import { QueueShaper } from "../tasks/queue-shaper.js";
import { CacheWarmer } from "../tools/cache-warmer.js";
import { MemoryCleanup } from "../memory/cleanup.js";
import { SelfImprovementEngine } from "../evolution/self-improvement.js";
import { SelfTestingSystem } from "../evolution/self-testing.js";
import { randomUUID } from "node:crypto";
import { validateGoal } from "./goal-validator.js";

export class AutonomyController {
  private autoscaler: WorkerAutoscaler;

  private shaper: QueueShaper;

  private warmer: CacheWarmer;

  private cleanup: MemoryCleanup;

  private discovery: GoalDiscoveryEngine;

  private remediator: AutoRemediator;

  private improver: SelfImprovementEngine;

  private tester: SelfTestingSystem;

  private timers: any[] = [];

  constructor(
    private readonly deps: AgentDeps,
    private readonly workerPool: TaskWorkerPool,
    private readonly mesh: KnowledgeMesh
  ) {
    this.autoscaler = new WorkerAutoscaler(deps, workerPool);
    this.shaper = new QueueShaper(deps);
    this.warmer = new CacheWarmer(deps);
    this.cleanup = new MemoryCleanup(deps);
    this.discovery = new GoalDiscoveryEngine(deps);
    this.remediator = new AutoRemediator(deps);
    this.improver = new SelfImprovementEngine(deps);
    this.tester = new SelfTestingSystem(deps);
  }

  start() {
    this.remediator.start();
    this.deps.bus?.on("pipeline.progress", (p) => {
      this.mesh.publish("pipeline.progress", p);
    });
    this.deps.bus?.on("pipeline.results", (p) => {
      this.mesh.publish("pipeline.results", p);
    });
    this.setInterval(() => this.autoscaler.tick(), 30_000);
    this.setInterval(() => this.shaper.tick(), 15_000);
    this.setInterval(() => this.warmer.warm(), 6 * 60 * 60 * 1000);
    this.setInterval(() => this.cleanup.run(), 24 * 60 * 60 * 1000);
    this.setInterval(() => this.goalTick(), 60_000);
    this.setInterval(() => this.reapTick(), 60_000);
    const improveEveryMs = Number(process.env.OPENCLAW_X_SELF_IMPROVE_EVERY_MS ?? 10 * 60_000);
    this.setInterval(() => this.selfImproveTick(), improveEveryMs);
    const selfTestEveryMs = Number(process.env.OPENCLAW_X_SELF_TEST_EVERY_MS ?? 15 * 60_000);
    this.setInterval(() => this.selfTestTick(), selfTestEveryMs);
  }

  stop() {
    for (const t of this.timers) {
      try {
        clearInterval(t);
      } catch {}
    }
    this.timers = [];
  }

  private setInterval(fn: () => Promise<void> | void, ms: number) {
    const h = setInterval(() => {
      Promise.resolve(fn()).catch(() => undefined);
    }, ms);
    if (typeof (h as any).unref === "function") (h as any).unref();
    this.timers.push(h);
  }

  private async goalTick() {
    const maxPending = Number(process.env.OPENCLAW_X_AUTONOMY_MAX_PENDING ?? 200);
    const stats = await this.deps.queue.stats();
    if (stats.pending >= maxPending) {
      await this.deps.memory.add("event", "goal_tick_skipped_backpressure", {
        pending: stats.pending,
        maxPending,
      });
      return;
    }
    await this.discovery.analyzeSignals();
    const maxGoals = Number(process.env.OPENCLAW_X_AUTONOMY_MAX_GOALS_PER_TICK ?? 3);
    const goals = this.discovery.takeNext(maxGoals);
    for (const g of goals) {
      const v = validateGoal({ title: g.title, rationale: g.rationale });
      if (!v.ok) {
        await this.deps.memory.add("event", "goal_rejected", {
          goalId: g.id,
          reason: v.reason,
          issues: v.issues,
        });
        continue;
      }
      const taskId = randomUUID();
      const task = {
        taskId,
        traceId: randomUUID(),
        sessionId: "system",
        userId: "system",
        userRole: "service" as const,
        type: "research" as const,
        priority: g.priority,
        payload: { query: g.title, rationale: g.rationale },
        status: "pending" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.deps.queue.enqueue(task as any);
      this.deps.metrics.counter("task_created_total").inc();
      await this.deps.memory.add("event", "goal_enqueued_as_task", { goalId: g.id, taskId });
    }
  }

  private async selfImproveTick() {
    if (process.env.OPENCLAW_X_ENABLE_SELF_IMPROVEMENT === "0") return;
    const insights = await this.improver.analyzePerformance();
    if (insights.length === 0) return;
    await this.deps.memory.add("event", "self_improvement_insights", {
      count: insights.length,
      insights,
    });
    if (process.env.OPENCLAW_X_APPLY_SELF_IMPROVEMENT === "1") {
      for (const i of insights) {
        if (i.confidence < 0.8) continue;
        await this.improver.applyOptimization(i);
      }
    }
  }

  private async selfTestTick() {
    if (process.env.OPENCLAW_X_ENABLE_SELF_TESTS === "0") return;
    const raw = String(process.env.OPENCLAW_X_SELF_TEST_TOOLS ?? "").trim();
    if (!raw) return;
    const tools = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25);
    if (tools.length === 0) return;
    for (const t of tools) {
      if (t === "project_tests") {
        await this.tester.runProjectTestSuite();
      } else {
        await this.tester.runToolSmokeTest(t);
      }
    }
  }

  private async reapTick() {
    const q: any = this.deps.queue as any;
    if (typeof q.reapStuckProcessing === "function") {
      await q.reapStuckProcessing(5 * 60_000, 50);
    }
  }
}
