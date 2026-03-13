import type { EventBus } from "../../infra/event-bus.js";
import type { MemorySystem } from "../../memory/memory-system.js";
import type { AgentStateStatus } from "../state/types.js";
import { StateMachine } from "./state-machine.js";

export enum AgentLifecycleState {
  INIT = "INIT",
  PLAN = "PLAN",
  EXECUTE = "EXECUTE",
  REVIEW = "REVIEW",
  FINALIZE = "FINALIZE",
  ERROR = "ERROR",
}

function defaultProgress(state: AgentLifecycleState) {
  if (state === AgentLifecycleState.INIT) return 0;
  if (state === AgentLifecycleState.PLAN) return 0.2;
  if (state === AgentLifecycleState.EXECUTE) return 0.6;
  if (state === AgentLifecycleState.REVIEW) return 0.9;
  if (state === AgentLifecycleState.FINALIZE) return 1;
  return 1;
}

export class AgentLifecycle {
  private readonly sm: StateMachine<AgentLifecycleState>;

  constructor(
    private readonly deps: {
      memory: MemorySystem;
      bus?: EventBus;
    },
    private readonly ids: {
      taskId: string;
      agentName: string;
      traceId?: string;
      contextHash?: string;
    }
  ) {
    this.sm = new StateMachine(AgentLifecycleState.INIT, {
      [AgentLifecycleState.INIT]: [AgentLifecycleState.PLAN, AgentLifecycleState.ERROR],
      [AgentLifecycleState.PLAN]: [AgentLifecycleState.EXECUTE, AgentLifecycleState.ERROR],
      [AgentLifecycleState.EXECUTE]: [AgentLifecycleState.REVIEW, AgentLifecycleState.ERROR],
      [AgentLifecycleState.REVIEW]: [AgentLifecycleState.FINALIZE, AgentLifecycleState.ERROR],
      [AgentLifecycleState.FINALIZE]: [],
      [AgentLifecycleState.ERROR]: [],
    });
  }

  state() {
    return this.sm.state();
  }

  async enter(params: {
    state: AgentLifecycleState;
    status: AgentStateStatus;
    progress?: number;
    context?: any;
    memoryRefs?: string[];
    memorySnapshot?: any;
  }) {
    if (params.state !== this.sm.state()) this.sm.transition(params.state);
    const now = Date.now();
    await this.deps.memory.saveAgentState({
      taskId: this.ids.taskId,
      agentName: this.ids.agentName,
      step: params.state,
      progress: Number.isFinite(params.progress) ? Number(params.progress) : defaultProgress(params.state),
      status: params.status,
      context: params.context,
      memoryRefs: Array.isArray(params.memoryRefs) ? params.memoryRefs : [],
      memorySnapshot: params.memorySnapshot,
      contextHash: this.ids.contextHash,
      updatedAt: now,
    } as any);
    this.deps.bus?.emit("agent.lifecycle", {
      agent: this.ids.agentName,
      taskId: this.ids.taskId,
      traceId: this.ids.traceId,
      state: params.state,
      status: params.status,
      progress: Number.isFinite(params.progress) ? Number(params.progress) : defaultProgress(params.state),
      ts: now,
    });
  }

  init(context?: any) {
    return this.enter({ state: AgentLifecycleState.INIT, status: "running", progress: 0, context });
  }

  plan(context?: any) {
    return this.enter({ state: AgentLifecycleState.PLAN, status: "running", context });
  }

  execute(context?: any) {
    return this.enter({ state: AgentLifecycleState.EXECUTE, status: "running", context });
  }

  review(context?: any) {
    return this.enter({ state: AgentLifecycleState.REVIEW, status: "running", context });
  }

  finalize(context?: any) {
    return this.enter({ state: AgentLifecycleState.FINALIZE, status: "completed", context });
  }

  error(context?: any) {
    return this.enter({ state: AgentLifecycleState.ERROR, status: "failed", context });
  }

  pause(context?: any) {
    return this.enter({ state: this.sm.state(), status: "paused", context });
  }
}

