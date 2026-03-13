import type { AIKernel } from "./runtime.js";
import { createRuntime } from "./runtime.js";

let runtimePromise: Promise<AIKernel> | undefined;

export function getRuntime(): Promise<AIKernel> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}
