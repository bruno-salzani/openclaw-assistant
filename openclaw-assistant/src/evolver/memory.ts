import fs from "node:fs";
import path from "node:path";
import { EvolutionResult } from "./types.js";

export class EvolverMemory {
  constructor(private readonly cwd: string) {}

  private filePath() {
    return path.join(this.cwd, ".evolver-history.jsonl");
  }

  append(result: EvolutionResult) {
    const line = JSON.stringify({ ...result, ts: Date.now() }) + "\n";
    fs.appendFileSync(this.filePath(), line, "utf8");
  }
}
