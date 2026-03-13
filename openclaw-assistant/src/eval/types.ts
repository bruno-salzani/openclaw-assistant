export type EvalAssertion = {
  mustContain?: string[];
  mustNotContain?: string[];
  regexMustMatch?: string[];
};

export type EvalCase = {
  id: string;
  prompt: string;
  assertions?: EvalAssertion;
  expect?: {
    minToolAttempts?: number;
    minToolSuccess?: number;
  };
  metadata?: Record<string, unknown>;
};

export type EvalRunOptions = {
  datasetPath: string;
  limit?: number;
  concurrency?: number;
};

export type EvalCaseResult = {
  id: string;
  ok: boolean;
  reason?: string;
  prompt: string;
  responseText: string;
  latencyMs: number;
  toolAttempts: number;
  toolSuccess: number;
  traceId: string;
  sessionId: string;
};

export type EvalReport = {
  startedAt: string;
  finishedAt: string;
  datasetPath: string;
  total: number;
  passed: number;
  accuracyPct: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  toolSuccessRatePct: number;
  results: EvalCaseResult[];
};
