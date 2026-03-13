import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { BenchResult, Evaluation, EvolverPatch, PatchReview, TestRunResult } from "../evolver/types.js";
import { PatchReviewer } from "../evolver/reviewer.js";
import { Evaluator } from "../evolver/evaluator.js";
import { TestRunner } from "../evolver/tester.js";
import { BenchRunner } from "../evolver/bench.js";
import { GitOps } from "../evolver/gitops.js";

type CommandResult = { ok: boolean; stdout: string; stderr: string };

function writeTempPatch(diff: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-self-improvement-"));
  const p = path.join(tmpDir, "patch.diff");
  fs.writeFileSync(p, diff, "utf8");
  return { tmpDir, patchPath: p };
}

function safeRm(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function runGit(cwd: string, args: string[]): CommandResult {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: res.status === 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || "") };
}

function gitStatusClean(repoRoot: string) {
  const res = runGit(repoRoot, ["status", "--porcelain"]);
  if (!res.ok) return false;
  return !String(res.stdout || "").trim();
}

function ensureSymlinkNodeModules(repoRoot: string, sandboxRoot: string) {
  const from = path.join(repoRoot, "node_modules");
  const to = path.join(sandboxRoot, "node_modules");
  if (!fs.existsSync(from)) return false;
  if (fs.existsSync(to)) return true;
  try {
    const type: any = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(from, to, type);
    return true;
  } catch {
    return false;
  }
}

export type PatchValidationPlan = {
  repoRoot: string;
  patch: EvolverPatch;
  apply?: boolean;
  commit?: boolean;
  runTests?: boolean;
  sandbox?: boolean;
  timeoutMs?: number;
};

export type PatchValidationResult = {
  ok: boolean;
  review: PatchReview;
  applyCheck: CommandResult;
  applied: boolean;
  committed: boolean;
  tests?: TestRunResult;
  bench?: BenchResult;
  evaluation?: Evaluation;
  errors: string[];
};

export class PatchValidator {
  private readonly reviewer = new PatchReviewer();

  private readonly tester = new TestRunner();

  private readonly bench = new BenchRunner();

  private readonly evaluator = new Evaluator();

  validateStatic(repoRoot: string, patch: EvolverPatch): PatchValidationResult {
    const review = this.reviewer.review(patch);
    const applyCheck = this.gitApplyCheck(repoRoot, patch.diff);
    const errors: string[] = [];

    if (!review.approved) errors.push(...review.reasons);
    if (!applyCheck.ok) errors.push("patch_not_applicable");

    return {
      ok: review.approved && applyCheck.ok,
      review,
      applyCheck,
      applied: false,
      committed: false,
      errors,
    };
  }

  validateAndOptionallyApply(plan: PatchValidationPlan): PatchValidationResult {
    const review = this.reviewer.review(plan.patch);
    const applyCheck = this.gitApplyCheck(plan.repoRoot, plan.patch.diff);
    const errors: string[] = [];

    if (!review.approved) errors.push(...review.reasons);
    if (!applyCheck.ok) errors.push("patch_not_applicable");
    if (errors.length > 0) {
      return {
        ok: false,
        review,
        applyCheck,
        applied: false,
        committed: false,
        errors,
      };
    }

    const apply = Boolean(plan.apply);
    const commit = Boolean(plan.commit);
    const runTests = Boolean(plan.runTests);
    const sandbox = Boolean(plan.sandbox);

    if ((apply || commit) && !gitStatusClean(plan.repoRoot)) {
      return {
        ok: false,
        review,
        applyCheck,
        applied: false,
        committed: false,
        errors: ["worktree_not_clean"],
      };
    }

    let tests: TestRunResult | undefined;
    if (runTests && sandbox) {
      tests = this.runSandboxNpmTest(plan.repoRoot, plan.patch.diff, plan.timeoutMs);
    }

    const bench = this.bench.run();
    const evaluation = this.evaluator.evaluate({ tests, bench });

    if (runTests && sandbox && !evaluation.accept) {
      return {
        ok: false,
        review,
        applyCheck,
        applied: false,
        committed: false,
        tests,
        bench,
        evaluation,
        errors: ["evaluation_rejected"],
      };
    }

    let applied = false;
    let committed = false;

    if (apply) {
      const git = new GitOps(plan.repoRoot);
      const res = git.applyPatch(plan.patch.diff);
      applied = res.ok;
      if (!applied) {
        return {
          ok: false,
          review,
          applyCheck,
          applied,
          committed: false,
          tests,
          bench,
          evaluation,
          errors: ["git_apply_failed"],
        };
      }

      if (runTests && !sandbox) {
        tests = this.tester.runNpmTest(plan.repoRoot, plan.timeoutMs);
      }

      const benchAfter = this.bench.run();
      const evaluationAfter = this.evaluator.evaluate({ tests, bench: benchAfter });
      if (!evaluationAfter.accept) {
        return {
          ok: false,
          review,
          applyCheck,
          applied,
          committed: false,
          tests,
          bench: benchAfter,
          evaluation: evaluationAfter,
          errors: ["evaluation_rejected"],
        };
      }

      if (commit) {
        const msg = `[self-improvement] ${plan.patch.title}`;
        const c = git.commit(msg);
        committed = c.ok;
      }

      return {
        ok: true,
        review,
        applyCheck,
        applied,
        committed,
        tests,
        bench: benchAfter,
        evaluation: evaluationAfter,
        errors: [],
      };
    }

    return {
      ok: evaluation.accept,
      review,
      applyCheck,
      applied,
      committed,
      tests,
      bench,
      evaluation,
      errors: evaluation.accept ? [] : ["evaluation_rejected"],
    };
  }

  private gitApplyCheck(repoRoot: string, diff: string): CommandResult {
    const { tmpDir, patchPath } = writeTempPatch(diff);
    const res = runGit(repoRoot, ["apply", "--check", "--whitespace=nowarn", patchPath]);
    safeRm(tmpDir);
    return res;
  }

  private runSandboxNpmTest(repoRoot: string, diff: string, timeoutMs?: number): TestRunResult {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-sandbox-"));
    const worktreeRes = runGit(repoRoot, ["worktree", "add", "--detach", tmpDir, "HEAD"]);
    if (!worktreeRes.ok) {
      safeRm(tmpDir);
      return {
        ok: false,
        exitCode: 1,
        stdout: String(worktreeRes.stdout || ""),
        stderr: String(worktreeRes.stderr || ""),
        durationMs: 0,
      };
    }

    const { tmpDir: patchTmpDir, patchPath } = writeTempPatch(diff);
    const applyRes = runGit(tmpDir, ["apply", "--whitespace=nowarn", patchPath]);
    safeRm(patchTmpDir);
    if (!applyRes.ok) {
      runGit(repoRoot, ["worktree", "remove", "--force", tmpDir]);
      safeRm(tmpDir);
      return {
        ok: false,
        exitCode: 1,
        stdout: String(applyRes.stdout || ""),
        stderr: String(applyRes.stderr || ""),
        durationMs: 0,
      };
    }

    ensureSymlinkNodeModules(repoRoot, tmpDir);
    const res = this.tester.runNpmTest(tmpDir, timeoutMs);

    runGit(repoRoot, ["worktree", "remove", "--force", tmpDir]);
    safeRm(tmpDir);

    return res;
  }
}

