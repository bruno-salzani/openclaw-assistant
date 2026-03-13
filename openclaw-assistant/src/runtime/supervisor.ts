import type { AgentDeps } from "../agents/agent-deps.js";
import type { AgentState } from "../agents/state/types.js";
import type { TaskWorkerPool } from "../tasks/worker-pool.js";
import { detectLoopingAgents, detectStuckAgents, type SupervisorHealth } from "./health-check.js";

function agentKey(s: AgentState) {
  const agent = String(s.agentName ?? s.agentId ?? "");
  return `${String(s.taskId)}:${agent}`;
}

export class RuntimeSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  constructor(
    private readonly deps: AgentDeps,
    private readonly workerPool: TaskWorkerPool
  ) {}

  start() {
    const enabled = process.env.IA_ASSISTANT_SUPERVISOR_ENABLE === "1";
    if (!enabled) return;
    if (this.timer) return;
    const intervalMs = Number(process.env.IA_ASSISTANT_SUPERVISOR_INTERVAL_MS ?? 30_000);
    const ms = Number.isFinite(intervalMs) ? Math.max(2_000, intervalMs) : 30_000;
    this.timer = setInterval(() => this.tick().catch(() => undefined), ms);
    if (typeof (this.timer as any).unref === "function") (this.timer as any).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<SupervisorHealth> {
    if (this.running) {
      return {
        now: Date.now(),
        runningAgents: 0,
        stuckAgents: [],
        loopingAgents: [],
      };
    }
    this.running = true;
    const now = Date.now();
    try {
      const queue = await this.deps.queue.stats().catch(() => undefined);
      const limit = Math.max(1, Math.min(500, Number(process.env.IA_ASSISTANT_SUPERVISOR_AGENT_SAMPLE_LIMIT ?? 200)));
      const states = await this.deps.memory.findRunningAgentStates(limit).catch(() => []);
      const stuckAfterMs = Number(process.env.IA_ASSISTANT_SUPERVISOR_STUCK_AGENT_MS ?? 5 * 60_000);
      const stuck = detectStuckAgents({ now, states, stuckAfterMs });

      const checkpointsByAgent = new Map<string, AgentState[]>();
      const loopCheckLimit = Math.max(10, Math.min(200, Number(process.env.IA_ASSISTANT_SUPERVISOR_LOOP_CHECKPOINTS_LIMIT ?? 40)));
      for (const s of states) {
        const a = String(s.agentName ?? s.agentId ?? "");
        if (!a) continue;
        if (typeof (this.deps.memory as any).listAgentStateCheckpoints !== "function") break;
        const history = await (this.deps.memory as any).listAgentStateCheckpoints(s.taskId, a, loopCheckLimit);
        if (Array.isArray(history)) checkpointsByAgent.set(agentKey({ ...s, agentName: a }), history);
      }
      const looping = detectLoopingAgents({ checkpointsByAgent });

      for (const x of stuck) {
        await this.handleStuck(x.state, x.ageMs).catch(() => undefined);
      }
      for (const x of looping) {
        await this.handleLoopDetected(x.state, x.repeats, x.windowSize).catch(() => undefined);
      }

      await this.ensureWorkers(queue).catch(() => undefined);

      return {
        now,
        queue,
        runningAgents: states.length,
        stuckAgents: stuck,
        loopingAgents: looping,
      };
    } finally {
      this.running = false;
    }
  }

  private async handleStuck(state: AgentState, ageMs: number) {
    const taskId = String(state.taskId ?? "");
    const agent = String(state.agentName ?? state.agentId ?? "");
    if (!taskId || !agent) return;

    this.deps.bus?.emit("supervisor.agent_stuck", { taskId, agent, ageMs });
    await this.deps.memory.add("event", "supervisor_agent_stuck", { taskId, agent, ageMs, step: state.step });

    await this.deps.memory.saveAgentState({
      taskId,
      agentName: agent,
      step: String(state.step ?? "stuck"),
      progress: Number.isFinite(state.progress) ? state.progress : 1,
      status: "failed",
      context: { reason: "stuck_agent", ageMs, prev: { step: state.step, status: state.status } },
      memoryRefs: [],
    } as any);

    if (typeof (this.deps.memory as any)?.updateTask === "function") {
      try {
        await (this.deps.memory as any).updateTask(taskId, "failed", undefined, {
          message: `supervisor_stuck_agent ageMs=${ageMs}`,
        });
      } catch {}
    }
  }

  private async handleLoopDetected(state: AgentState, repeats: number, windowSize: number) {
    const taskId = String(state.taskId ?? "");
    const agent = String(state.agentName ?? state.agentId ?? "");
    if (!taskId || !agent) return;

    this.deps.bus?.emit("supervisor.loop_detected", { taskId, agent, repeats, windowSize, step: state.step });
    await this.deps.memory.add("event", "supervisor_loop_detected", {
      taskId,
      agent,
      repeats,
      windowSize,
      step: state.step,
    });

    await this.deps.memory.saveAgentState({
      taskId,
      agentName: agent,
      step: String(state.step ?? "loop"),
      progress: Number.isFinite(state.progress) ? state.progress : 0,
      status: "paused",
      context: { reason: "loop_detected", repeats, windowSize },
      memoryRefs: [],
    } as any);
  }

  private async ensureWorkers(queue?: { pending: number; running: number }) {
    const enabled = process.env.IA_ASSISTANT_SUPERVISOR_SCALE_WORKERS === "1";
    if (!enabled) return;
    const pending = Number(queue?.pending ?? 0);
    if (pending <= 0) return;
    const minResearch = Number(process.env.IA_ASSISTANT_SUPERVISOR_MIN_RESEARCH_WORKERS ?? 0);
    const minExecute = Number(process.env.IA_ASSISTANT_SUPERVISOR_MIN_EXECUTE_WORKERS ?? 0);
    const minAnalyze = Number(process.env.IA_ASSISTANT_SUPERVISOR_MIN_ANALYZE_WORKERS ?? 0);
    const counts = this.workerPool.getWorkerCounts?.() ?? {};

    const ensure = (key: string, desired: number, types: any[]) => {
      const cur = Number(counts[key] ?? 0);
      const want = Math.max(0, Math.floor(desired));
      if (want <= cur) return;
      this.workerPool.start(want - cur, types);
      this.deps.metrics.counter("supervisor_workers_started_total").inc(want - cur);
    };

    ensure("research", minResearch, ["research"]);
    ensure("execute", minExecute, ["execute"]);
    ensure("analyze", minAnalyze, ["analyze"]);
  }
}

