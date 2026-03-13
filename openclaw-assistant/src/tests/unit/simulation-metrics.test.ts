import test from "node:test";
import assert from "node:assert/strict";
import { computeRunMetrics } from "../../simulation/metrics-engine.js";
import { evaluateAgent } from "../../simulation/agent-evaluator.js";

test("MetricsEngine computes success rate and evaluator returns a bounded score", async () => {
  const metrics = computeRunMetrics([
    { ok: true, latencyMs: 100, outputChars: 10 },
    { ok: false, latencyMs: 200, outputChars: 0 },
  ]);
  assert.equal(metrics.successRate, 0.5);
  const score = evaluateAgent({ metrics, hallucinationRate: 0.1, avgTokenCostUsd: 0.001 });
  assert.ok(score.score >= 0 && score.score <= 1);
});

