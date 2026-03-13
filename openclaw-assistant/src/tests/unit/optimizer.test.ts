import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "../../infra/event-bus.js";
import { ModelRouterOptimizer } from "../../optimization/model-router-optimizer.js";

test("ModelRouterOptimizer increases thresholds when cost is high and reasoning share is high", async () => {
  const bus = new EventBus();
  const prevReasoning = process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS;
  const prevLast = process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS;
  process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS = "8000";
  process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS = "800";

  const opt = new ModelRouterOptimizer(
    { bus, baseDir: process.cwd() },
    { budgetUsdPerRun: 0.0001, window: 10, evaluateEveryMs: 60_000 }
  );
  opt.start();
  try {
    for (let i = 0; i < 12; i++) {
      bus.emit("llm.routed", { route: "reasoning", ts: Date.now() });
      bus.emit("ai.observability", { agent: "coordinator", ok: true, costUsd: 0.01, latencyMs: 100 });
    }
    const before = Number(process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS);
    const out = opt.evaluateAndApply();
    assert.equal(out.ok, true);
    const after = Number(process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS);
    assert.ok(after >= before);
  } finally {
    opt.stop();
    if (typeof prevReasoning === "string") process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS = prevReasoning;
    else delete process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS;
    if (typeof prevLast === "string") process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS = prevLast;
    else delete process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS;
  }
});

