import type { AgentContext, AgentRole } from "../agents/types.js";

export type CognitivePerception = {
  modality: string;
  objective: string;
  complexity: "low" | "medium" | "high";
  domainHints: string[];
  signals: { hasCode: boolean; wantsAnalysis: boolean; wantsExecution: boolean };
};

export type CognitiveReasoning = {
  assumptions: string[];
  risks: string[];
  constraints: string[];
  spawn: Array<{
    id: string;
    role: AgentRole;
    prompt: string;
  }>;
};

export type CognitivePlan = {
  strategy: "planning" | "direct";
  spawn: CognitiveReasoning["spawn"];
};

export type SpawnRun = {
  id: string;
  role: AgentRole;
  ok: boolean;
  text: string;
  meta?: Record<string, unknown>;
};

export type CognitiveExecution = {
  spawnRuns: SpawnRun[];
  contextText: string;
};

export type CognitiveReflection = {
  critique: string;
  revised: string;
  ok: boolean;
};

export type CognitiveLearningRecord = {
  ts: number;
  sessionId: string;
  userId: string;
  objective: string;
  perception: CognitivePerception;
  plan: CognitivePlan;
  spawnRuns: Array<Pick<SpawnRun, "id" | "role" | "ok">>;
  outputHash: string;
};

export type CognitiveInput = {
  ctx: AgentContext;
  text: string;
};

