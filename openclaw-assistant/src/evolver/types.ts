export type EvolverTaskType =
  | "refactor_candidate"
  | "add_test_candidate"
  | "reduce_risk_candidate"
  | "performance_candidate";

export type EvolverTask = {
  id: string;
  type: EvolverTaskType;
  title: string;
  filePath?: string;
  evidence?: string[];
  priority: "low" | "medium" | "high";
  createdAt: number;
};

export type RepoAnalysis = {
  rootDir: string;
  tsFiles: Array<{ path: string; size: number; loc: number }>;
  totalFiles: number;
  totalLoc: number;
  largestFiles: Array<{ path: string; size: number; loc: number }>;
  findings: Array<{ title: string; evidence: string[]; severity: "low" | "medium" | "high" }>;
};

export type EvolverPatch = {
  taskId: string;
  title: string;
  diff: string;
  filesTouched: string[];
};

export type PatchReview = {
  approved: boolean;
  reasons: string[];
  risk: "low" | "medium" | "high";
};

export type TestRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type BenchResult = {
  ok: boolean;
  metrics: Record<string, number>;
};

export type Evaluation = {
  accept: boolean;
  reasons: string[];
};

export type EvolutionResult = {
  task: EvolverTask;
  patch?: EvolverPatch;
  review?: PatchReview;
  tests?: TestRunResult;
  bench?: BenchResult;
  evaluation?: Evaluation;
  applied?: boolean;
  committed?: boolean;
};
