import fs from "node:fs";
import path from "node:path";

export type PromptVersion = {
  id: string;
  key: string;
  text: string;
  score?: number;
  ts: number;
  meta?: Record<string, unknown>;
};

export class PromptStore {
  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath() {
    const p = String(process.env.IA_ASSISTANT_PROMPT_EVOLUTION_PATH ?? "").trim();
    if (p) return path.resolve(this.baseDir, p);
    return path.join(this.baseDir, ".ia-assistant", "prompt-evolution", "prompts.json");
  }

  readAll(): { prompts: PromptVersion[] } {
    const p = this.filePath();
    try {
      if (!fs.existsSync(p)) return { prompts: [] };
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
      return { prompts: prompts as PromptVersion[] };
    } catch {
      return { prompts: [] };
    }
  }

  upsert(v: PromptVersion) {
    const cur = this.readAll();
    const idx = cur.prompts.findIndex((p) => p.id === v.id);
    if (idx >= 0) cur.prompts[idx] = v;
    else cur.prompts.push(v);
    const p = this.filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cur, null, 2));
    return v;
  }

  latestByKey(key: string) {
    const k = String(key ?? "").trim();
    const cur = this.readAll();
    const matches = cur.prompts.filter((p) => String(p.key ?? "") === k);
    matches.sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0));
    return matches[0] ?? null;
  }
}

