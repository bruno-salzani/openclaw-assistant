import { BenchResult, Evaluation, TestRunResult } from "./types.js";

export class Evaluator {
  evaluate(params: { tests?: TestRunResult; bench?: BenchResult }): Evaluation {
    const reasons: string[] = [];
    if (params.tests && !params.tests.ok) reasons.push("tests_failed");
    if (params.bench && !params.bench.ok) reasons.push("bench_failed");
    return { accept: reasons.length === 0, reasons };
  }
}
