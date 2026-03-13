import { BenchResult } from "./types.js";

export class BenchRunner {
  run(): BenchResult {
    return { ok: true, metrics: {} };
  }
}
