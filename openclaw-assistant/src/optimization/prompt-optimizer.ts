import fs from "node:fs";
import path from "node:path";

type UserCorrectionRow = {
  type: "user_correction";
  input: string;
  output?: string;
  target?: string;
  meta?: Record<string, unknown>;
};

export function loadLatestTrainingDataset(baseDir: string) {
  const dir = path.join(baseDir, ".ia-assistant", "learning", "datasets");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("dataset-") && f.endsWith(".jsonl"))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const latest = files[0]?.f;
    if (!latest) return null;
    return path.join(dir, latest);
  } catch {
    return null;
  }
}

export function buildPromptImprovementCandidates(params: {
  datasetPath: string;
  limit?: number;
}) {
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(50_000, params.limit)) : 10_000;
  const raw = fs.readFileSync(params.datasetPath, "utf-8");
  const rows = raw
    .split(/\r?\n/g)
    .filter((l) => l.trim().length > 0)
    .slice(0, limit)
    .map((l) => {
      try {
        return JSON.parse(l) as any;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as UserCorrectionRow[];

  const corrections = rows.filter((r) => r.type === "user_correction");
  const suggestions = corrections
    .map((c) => ({
      prompt: String(c.input ?? ""),
      answer: String(c.output ?? ""),
      correction: String(c.target ?? ""),
      meta: c.meta ?? {},
    }))
    .filter((x) => x.prompt.trim() && x.correction.trim());

  return { ok: true, totalRows: rows.length, userCorrections: suggestions.length, suggestions };
}

