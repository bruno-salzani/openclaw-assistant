import type { AgentState } from "../agents/state/types.js";
import type { TaskQueueStats } from "../tasks/task-queue.js";

export type StuckAgent = {
  state: AgentState;
  ageMs: number;
};

export type LoopingAgent = {
  state: AgentState;
  repeats: number;
  windowSize: number;
};

export type SupervisorHealth = {
  now: number;
  queue?: TaskQueueStats;
  runningAgents: number;
  stuckAgents: StuckAgent[];
  loopingAgents: LoopingAgent[];
};

function normalizeStep(v: unknown) {
  return String(v ?? "").trim().toUpperCase();
}

export function detectStuckAgents(params: { now: number; states: AgentState[]; stuckAfterMs: number }) {
  const stuckAfterMs = Math.max(1_000, Number(params.stuckAfterMs));
  const out: StuckAgent[] = [];
  for (const s of params.states) {
    if (!s || typeof s !== "object") continue;
    if (s.status !== "running") continue;
    const updatedAt = Number(s.updatedAt ?? 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
    const ageMs = params.now - updatedAt;
    if (!Number.isFinite(ageMs) || ageMs < stuckAfterMs) continue;
    out.push({ state: s, ageMs });
  }
  out.sort((a, b) => b.ageMs - a.ageMs);
  return out;
}

export function detectLoopingAgents(params: { checkpointsByAgent: Map<string, AgentState[]> }) {
  const out: LoopingAgent[] = [];
  for (const [_k, checkpoints] of params.checkpointsByAgent.entries()) {
    const list = Array.isArray(checkpoints) ? checkpoints : [];
    if (list.length < 8) continue;
    const steps = list.map((s) => normalizeStep(s.step)).filter(Boolean);
    if (steps.length < 8) continue;
    const windowSize = Math.min(20, steps.length);
    const tail = steps.slice(steps.length - windowSize);
    const last = tail[tail.length - 1] ?? "";
    if (!last) continue;
    const repeats = tail.filter((x) => x === last).length;
    if (repeats < Math.ceil(windowSize * 0.7)) continue;
    const state = list[list.length - 1]!;
    out.push({ state, repeats, windowSize });
  }
  out.sort((a, b) => b.repeats - a.repeats);
  return out;
}
