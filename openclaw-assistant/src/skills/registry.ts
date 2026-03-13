import fs from "node:fs";
import path from "node:path";

export type SkillManifest = {
  id: string;
  name: string;
  tools: string[];
  steps: string[];
};

export type SkillRegistryState = { skills: SkillManifest[] };

function normalizeId(id: string) {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export class SkillRegistry {
  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    const p = String(process.env.IA_ASSISTANT_SKILL_REGISTRY_PATH ?? "").trim();
    if (p) return path.resolve(this.baseDir, p);
    return path.join(this.baseDir, ".ia-assistant", "skills", "registry.json");
  }

  read(): SkillRegistryState {
    const p = this.filePath();
    try {
      if (!fs.existsSync(p)) return { skills: [] };
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
      return {
        skills: skills
          .map((s: any) => ({
            id: normalizeId(String(s?.id ?? s?.name ?? "")),
            name: typeof s?.name === "string" ? String(s.name) : "Skill",
            tools: Array.isArray(s?.tools) ? s.tools.map(String).filter(Boolean) : [],
            steps: Array.isArray(s?.steps) ? s.steps.map(String).filter(Boolean) : [],
          }))
          .filter((s: SkillManifest) => Boolean(s.id && (s.tools.length > 0 || s.steps.length > 0))),
      };
    } catch {
      return { skills: [] };
    }
  }

  write(state: SkillRegistryState) {
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  }
}

