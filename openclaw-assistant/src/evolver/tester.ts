import { spawnSync } from "node:child_process";
import { TestRunResult } from "./types.js";

export class TestRunner {
  runNpmTest(cwd: string, timeoutMs = 10 * 60_000): TestRunResult {
    const start = Date.now();
    const res = spawnSync("npm", ["test"], { cwd, encoding: "utf8", timeout: timeoutMs });
    const durationMs = Date.now() - start;
    const code = typeof res.status === "number" ? res.status : 1;
    return {
      ok: code === 0,
      exitCode: code,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
      durationMs,
    };
  }
}
