import path from "node:path";
import { RepoPlanner } from "./planner.js";
import { TaskGenerator } from "./taskgen.js";
import { PatchCoder } from "./coder.js";
import { PatchReviewer } from "./reviewer.js";
import { TestRunner } from "./tester.js";
import { BenchRunner } from "./bench.js";
import { Evaluator } from "./evaluator.js";
import { GitOps } from "./gitops.js";
import { EvolverMemory } from "./memory.js";
import type { EvolutionResult } from "./types.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { EvolverTask } from "./types.js";

export type EvolverOptions = {
  repoRoot: string;
  apply: boolean;
  commit: boolean;
  runTests: boolean;
  llm?: LLMProvider;
  tasks?: EvolverTask[];
};

export class EvolutionLoop {
  private readonly planner = new RepoPlanner();

  private readonly taskgen = new TaskGenerator();

  private coder(opts: { llm?: LLMProvider }) {
    return new PatchCoder(opts.llm);
  }

  private readonly reviewer = new PatchReviewer();

  private readonly tester = new TestRunner();

  private readonly bench = new BenchRunner();

  private readonly evaluator = new Evaluator();

  async runOnce(opts: EvolverOptions): Promise<EvolutionResult[]> {
    const analysis = this.planner.analyzeRepo(opts.repoRoot);
    const tasks = Array.isArray(opts.tasks) && opts.tasks.length > 0 ? opts.tasks : this.taskgen.generate(analysis);
    const memory = new EvolverMemory(opts.repoRoot);
    const results: EvolutionResult[] = [];
    const git = new GitOps(opts.repoRoot);
    const coder = this.coder({ llm: opts.llm });

    for (const task of tasks) {
      const result: EvolutionResult = { task };
      const patch = await coder.createPatch(task, analysis.rootDir);
      if (!patch) {
        memory.append(result);
        results.push(result);
        continue;
      }
      result.patch = patch;

      const review = this.reviewer.review(patch);
      result.review = review;
      if (!review.approved) {
        memory.append(result);
        results.push(result);
        continue;
      }

      if (opts.apply) {
        const applied = git.applyPatch(patch.diff);
        result.applied = applied.ok;
        if (!applied.ok) {
          memory.append(result);
          results.push(result);
          continue;
        }
      }

      if (opts.runTests) {
        result.tests = this.tester.runNpmTest(opts.repoRoot);
      }
      result.bench = this.bench.run();
      result.evaluation = this.evaluator.evaluate({ tests: result.tests, bench: result.bench });

      if (opts.apply && opts.commit && result.evaluation.accept) {
        const msg = `[evolver] ${patch.title}`;
        const committed = git.commit(msg);
        result.committed = committed.ok;
      }

      memory.append(result);
      results.push(result);
    }

    return results;
  }
}

export function resolveRepoRootFromCwd(cwd: string) {
  return path.resolve(cwd);
}
