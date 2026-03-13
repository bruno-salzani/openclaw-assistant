import fs from "node:fs";
import path from "node:path";
import type { ExperienceEvent } from "./experience-collector.js";
import { analyzeExperiences } from "../failure-analyzer.js";

export type DatasetBuildResult = {
  ok: boolean;
  filePath: string;
  examples: number;
  counters: Record<string, number>;
};

export function buildDataset(params: { baseDir: string; events: ExperienceEvent[]; fileName?: string }): DatasetBuildResult {
  const baseDir = params.baseDir ?? process.cwd();
  const outDir = path.join(baseDir, ".ia-assistant", "learning", "datasets");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, params.fileName ?? `dataset-${Date.now()}.jsonl`);
  const analyzed = analyzeExperiences(params.events);
  const lines = analyzed.examples.map((ex) => JSON.stringify(ex));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
  return { ok: true, filePath, examples: analyzed.examples.length, counters: analyzed.counters };
}

