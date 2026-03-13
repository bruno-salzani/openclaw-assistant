import type { LLMMessage } from "../llm/llm-provider.js";
import type { LLMRouter } from "../llm/router.js";

export type ModelBenchmarkCase = {
  id: string;
  messages: LLMMessage[];
  expectedContains?: string;
};

export type ModelBenchmarkResult = {
  ok: boolean;
  routes: string[];
  results: Array<{
    caseId: string;
    route: string;
    latencyMs: number;
    passed?: boolean;
    outputPreview: string;
  }>;
};

export async function benchmarkModels(params: {
  router: LLMRouter;
  routes: Array<"cheap" | "reasoning" | "coding" | "offline" | "default">;
  cases: ModelBenchmarkCase[];
}): Promise<ModelBenchmarkResult> {
  const routes = params.routes.slice(0, 6);
  const cases = params.cases.slice(0, 30);
  const results: ModelBenchmarkResult["results"] = [];

  for (const c of cases) {
    for (const r of routes) {
      const t0 = Date.now();
      let out = "";
      let ok = true;
      try {
        out = await params.router.chatWithRoute(r, { messages: c.messages, temperature: 0.2, maxTokens: 800 });
      } catch (e: any) {
        ok = false;
        out = `ERROR: ${String(e?.message ?? e)}`;
      }
      const latencyMs = Date.now() - t0;
      const expected = typeof c.expectedContains === "string" ? c.expectedContains : "";
      const passed = expected ? String(out).toLowerCase().includes(expected.toLowerCase()) : undefined;
      results.push({
        caseId: c.id,
        route: r,
        latencyMs,
        passed: ok ? passed : false,
        outputPreview: String(out).slice(0, 220),
      });
    }
  }

  return { ok: true, routes, results };
}

