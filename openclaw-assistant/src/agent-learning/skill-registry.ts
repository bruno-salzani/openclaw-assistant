import fs from "node:fs";
import path from "node:path";

export type LearnedSkillStep = {
  tool: string;
  argsTemplate: Record<string, any>;
};

export type LearnedSkillSpec = {
  id: string;
  description: string;
  steps: LearnedSkillStep[];
  createdAt: number;
  updatedAt: number;
  status: "active" | "pending" | "rejected";
  meta?: Record<string, unknown>;
};

export type SkillRegistryState = {
  skills: LearnedSkillSpec[];
};

function defaultState(): SkillRegistryState {
  return { skills: [] };
}

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
    return path.join(this.baseDir, ".ia-assistant", "skill-learning", "skills.json");
  }

  read(): SkillRegistryState {
    const p = this.filePath();
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
      return {
        skills: skills
          .map((s: any) => ({
            id: normalizeId(String(s?.id ?? "")),
            description: typeof s?.description === "string" ? String(s.description) : "Learned skill",
            steps: Array.isArray(s?.steps)
              ? s.steps
                  .map((st: any) => ({
                    tool: String(st?.tool ?? ""),
                    argsTemplate:
                      st?.argsTemplate && typeof st.argsTemplate === "object" ? st.argsTemplate : {},
                  }))
                  .filter((st: LearnedSkillStep) => Boolean(st.tool))
              : [],
            createdAt: Number(s?.createdAt ?? Date.now()),
            updatedAt: Number(s?.updatedAt ?? Date.now()),
            status:
              s?.status === "active" || s?.status === "rejected" || s?.status === "pending"
                ? s.status
                : "pending",
            meta: s?.meta && typeof s.meta === "object" ? s.meta : undefined,
          }))
          .filter((s: LearnedSkillSpec) => Boolean(s.id && s.steps.length > 0)),
      };
    } catch {
      return defaultState();
    }
  }

  write(state: SkillRegistryState) {
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  }

  list(params?: { status?: LearnedSkillSpec["status"] }) {
    const s = this.read().skills;
    if (!params?.status) return s;
    return s.filter((x) => x.status === params.status);
  }

  get(id: string) {
    const key = normalizeId(id);
    return this.read().skills.find((s) => s.id === key) ?? null;
  }

  upsert(spec: Omit<LearnedSkillSpec, "id" | "createdAt" | "updatedAt"> & { id: string }) {
    const state = this.read();
    const now = Date.now();
    const id = normalizeId(spec.id);
    const idx = state.skills.findIndex((s) => s.id === id);
    const next: LearnedSkillSpec = {
      id,
      description: String(spec.description ?? "Learned skill"),
      steps: Array.isArray(spec.steps) ? spec.steps : [],
      createdAt: now,
      updatedAt: now,
      status: spec.status ?? "pending",
      meta: spec.meta,
    };
    if (idx >= 0) {
      const prev = state.skills[idx]!;
      state.skills[idx] = { ...prev, ...next, createdAt: prev.createdAt, updatedAt: now };
    } else {
      state.skills.push(next);
    }
    this.write(state);
    return this.get(id);
  }
}

