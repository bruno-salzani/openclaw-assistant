import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { EvalCase, EvalCaseResult, EvalReport } from "./types.js";
import { loadJsonlDataset } from "./dataset.js";
import { evaluateAssertions } from "./assertions.js";
import { createRuntime } from "../runtime.js";
import { sanitizeInput } from "../security/input-sanitizer.js";
import { AgentContextBuilder } from "../agents/context-builder.js";

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function evalOne(params: {
  runtime: Awaited<ReturnType<typeof createRuntime>>;
  c: EvalCase;
}) {
  const traceId = randomUUID();
  const sessionId = `eval-${params.c.id}-${Date.now()}`;
  const started = Date.now();
  const sanitizedText = sanitizeInput(params.c.prompt || "");
  const builtContext = await new AgentContextBuilder({
    memory: params.runtime.memory,
    graph: params.runtime.graph,
    queue: params.runtime.queue,
  }).buildContext({
    sessionId,
    query: sanitizedText,
    userId: "eval",
    workspaceId: undefined,
  });
  const response = await params.runtime.orchestrator.run({
    sessionId,
    userId: "eval",
    userRole: "admin",
    channel: "eval",
    text: sanitizedText,
    history: builtContext?.llmMessages ?? builtContext?.history,
    metadata: {
      ...(params.c.metadata ?? {}),
      traceId,
      modality: "text",
      workspaceId: undefined,
      contextText: builtContext?.contextText,
    },
  });
  const latencyMs = Date.now() - started;

  const snap = await params.runtime.queue.snapshot(5000);
  const tasksById = new Map(snap.tasks.map((t) => [t.taskId, t]));
  const results = snap.results.filter((r) => r.traceId === traceId);
  const toolAttempts = results.filter((r) => tasksById.get(r.taskId)?.type === "execute").length;
  const toolSuccess = results.filter(
    (r) => tasksById.get(r.taskId)?.type === "execute" && r.ok
  ).length;

  const responseText = String((response as any).text ?? "");
  const assertion = evaluateAssertions(responseText, params.c.assertions);
  let ok = assertion.ok;
  let reason = assertion.ok ? undefined : assertion.reason;

  const minToolAttempts = Number(params.c.expect?.minToolAttempts ?? 0);
  const minToolSuccess = Number(params.c.expect?.minToolSuccess ?? 0);
  if (Number.isFinite(minToolAttempts) && minToolAttempts > 0 && toolAttempts < minToolAttempts) {
    ok = false;
    reason = `tool attempts ${toolAttempts} < ${minToolAttempts}`;
  }
  if (Number.isFinite(minToolSuccess) && minToolSuccess > 0 && toolSuccess < minToolSuccess) {
    ok = false;
    reason = `tool success ${toolSuccess} < ${minToolSuccess}`;
  }

  const out: EvalCaseResult = {
    id: params.c.id,
    ok,
    reason,
    prompt: params.c.prompt,
    responseText,
    latencyMs,
    toolAttempts,
    toolSuccess,
    traceId,
    sessionId,
  };
  return out;
}

export async function runEval(params: { datasetPath: string; limit?: number }) {
  const startedAt = new Date().toISOString();
  const cases = loadJsonlDataset(params.datasetPath);
  const limited = Number.isFinite(params.limit)
    ? cases.slice(0, Math.max(0, params.limit!))
    : cases;

  const runtime = await createRuntime();
  try {
    const results: EvalCaseResult[] = [];
    for (const c of limited) {
      results.push(await evalOne({ runtime, c }));
    }

    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const passed = results.filter((r) => r.ok).length;
    const toolAttempts = results.reduce((a, r) => a + r.toolAttempts, 0);
    const toolSuccess = results.reduce((a, r) => a + r.toolSuccess, 0);
    const avgLatencyMs = results.length
      ? results.reduce((a, r) => a + r.latencyMs, 0) / results.length
      : 0;

    const report: EvalReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      datasetPath: params.datasetPath,
      total: results.length,
      passed,
      accuracyPct: results.length ? (passed / results.length) * 100 : 0,
      avgLatencyMs,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      toolSuccessRatePct: toolAttempts > 0 ? (toolSuccess / toolAttempts) * 100 : 100,
      results,
    };

    const reportsDir = path.resolve(process.cwd(), "eval", "reports");
    ensureDir(reportsDir);
    const file = path.join(reportsDir, `report-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return { report, reportPath: file };
  } finally {
    runtime.stop();
  }
}
