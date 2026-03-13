import fs from "node:fs";

import type { EvalCase } from "./types.js";

export function loadJsonlDataset(path: string): EvalCase[] {
  const raw = fs.readFileSync(path, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const out: EvalCase[] = [];
  for (const l of lines) {
    const obj = JSON.parse(l);
    if (!obj || typeof obj !== "object") continue;
    const id = typeof (obj as any).id === "string" ? String((obj as any).id) : "";
    const prompt = typeof (obj as any).prompt === "string" ? String((obj as any).prompt) : "";
    if (!id || !prompt) continue;
    out.push(obj as EvalCase);
  }
  return out;
}
