import type { Skill } from "../skill-types.js";
import { execSync } from "child_process";

export const dockerSkill: Skill = {
  id: "docker",
  description: "Manage Docker containers",
  commands: [
    {
      name: "list_containers",
      input: {},
      run: async () => {
        try {
          const stdout = execSync("docker ps --format '{{json .}}'", { encoding: "utf-8" });
          return stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      },
    },
    {
      name: "run_container",
      input: { image: "string", command: "string" },
      run: async (input) => {
        const { image, command } = input as { image: string; command?: string };
        const cmd = `docker run --rm ${image} ${command || ""}`;
        try {
          const stdout = execSync(cmd, { timeout: 10000, encoding: "utf-8" });
          return { ok: true, stdout };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      },
    },
  ],
};
