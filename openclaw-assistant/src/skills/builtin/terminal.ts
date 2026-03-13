import type { Skill } from "../skill-types.js";
import { execSync } from "child_process";
import { runShellInDocker } from "../../sandbox/docker-runner.js";

export const terminalSkill: Skill = {
  id: "terminal",
  description: "Execute shell commands securely",
  commands: [
    {
      name: "run",
      input: { command: "string" },
      run: async (input) => {
        const { command } = input as { command: string };
        if (String(process.env.IA_ASSISTANT_TERMINAL_DOCKER ?? "0") === "1") {
          const res = await runShellInDocker({ command, timeoutMs: 12_000 });
          return res.ok
            ? { ok: true, stdout: res.stdout }
            : { ok: false, error: res.error, stderr: res.stderr };
        }
        // NOTE: In a real system, this MUST run inside the Sandbox container/VM
        // The ToolExecutionEngine handles the sandbox wrapping, here we just implement the logic
        try {
          const stdout = execSync(command, { timeout: 5000, encoding: "utf-8" });
          return { ok: true, stdout };
        } catch (err: any) {
          return { ok: false, error: err.message, stderr: err.stderr?.toString() };
        }
      },
    },
  ],
};
