import type { Skill } from "../skill-types.js";
import fs from "fs/promises";
import path from "path";

const SAFE_ROOT = process.env.OPENCLAW_X_FS_ROOT || "/tmp/openclaw-fs";

export const filesystemSkill: Skill = {
  id: "filesystem",
  description: "Read and write files securely",
  init: async () => {
    await fs.mkdir(SAFE_ROOT, { recursive: true });
  },
  commands: [
    {
      name: "read_file",
      input: { path: "string" },
      run: async (input) => {
        const { path: relPath } = input as { path: string };
        const safePath = path.resolve(SAFE_ROOT, relPath.replace(/^\//, ""));
        if (!safePath.startsWith(SAFE_ROOT)) throw new Error("Access denied");

        try {
          const content = await fs.readFile(safePath, "utf-8");
          return { ok: true, content };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      },
    },
    {
      name: "write_file",
      input: { path: "string", content: "string" },
      run: async (input) => {
        const { path: relPath, content } = input as { path: string; content: string };
        const safePath = path.resolve(SAFE_ROOT, relPath.replace(/^\//, ""));
        if (!safePath.startsWith(SAFE_ROOT)) throw new Error("Access denied");

        try {
          await fs.writeFile(safePath, content, "utf-8");
          return { ok: true };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      },
    },
  ],
};
