import type { LLMProvider } from "../llm/llm-provider.js";
import type { EvolverPatch, EvolverTask, RepoAnalysis } from "../evolver/types.js";
import { RepoPlanner } from "../evolver/planner.js";
import { PatchCoder } from "../evolver/coder.js";

export class PatchGenerator {
  private readonly planner = new RepoPlanner();

  private readonly coder: PatchCoder;

  constructor(private readonly deps: { llm?: LLMProvider }) {
    this.coder = new PatchCoder(deps.llm);
  }

  analyzeRepo(repoRoot: string): RepoAnalysis {
    return this.planner.analyzeRepo(repoRoot);
  }

  async generateForTask(params: {
    analysis: RepoAnalysis;
    task: EvolverTask;
  }): Promise<EvolverPatch | null> {
    return this.coder.createPatch(params.task, params.analysis.rootDir);
  }

  async generateForTasks(params: {
    analysis: RepoAnalysis;
    tasks: EvolverTask[];
    limit?: number;
  }): Promise<Array<{ task: EvolverTask; patch: EvolverPatch }>> {
    const limRaw = params.limit ?? 5;
    const lim = Number.isFinite(limRaw) ? Math.max(1, Math.min(25, Math.floor(limRaw))) : 5;
    const out: Array<{ task: EvolverTask; patch: EvolverPatch }> = [];

    for (const task of params.tasks.slice(0, lim)) {
      const patch = await this.generateForTask({ analysis: params.analysis, task });
      if (!patch) continue;
      out.push({ task, patch });
    }

    return out;
  }
}

