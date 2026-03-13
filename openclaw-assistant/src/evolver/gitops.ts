import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export class GitOps {
  constructor(private readonly cwd: string) {}

  applyPatch(diff: string): { ok: boolean; stdout: string; stderr: string } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-patch-"));
    const p = path.join(tmpDir, "patch.diff");
    fs.writeFileSync(p, diff, "utf8");
    const res = spawnSync("git", ["apply", "--whitespace=nowarn", p], {
      cwd: this.cwd,
      encoding: "utf8",
    });
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    return {
      ok: res.status === 0,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
    };
  }

  commit(message: string): { ok: boolean; stdout: string; stderr: string } {
    const res = spawnSync("git", ["commit", "-am", message], { cwd: this.cwd, encoding: "utf8" });
    return {
      ok: res.status === 0,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
    };
  }

  createBranch(name: string): { ok: boolean; stdout: string; stderr: string } {
    const res = spawnSync("git", ["checkout", "-b", name], { cwd: this.cwd, encoding: "utf8" });
    return {
      ok: res.status === 0,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
    };
  }
}
