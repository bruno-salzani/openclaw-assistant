import test from "node:test";
import assert from "node:assert/strict";
import { MetricsRegistry } from "../../observability/metrics.js";
import { TriggerEngine } from "../../triggers/engine.js";
import { TriggerDedupeStore } from "../../triggers/dedupe-store.js";

test("TriggerEngine: dedupe evita execução duplicada", async () => {
  const metrics = new MetricsRegistry();
  let calls = 0;
  const workflows: any = {
    execute: async () => {
      calls += 1;
    },
  };
  const dedupe = new TriggerDedupeStore();
  const engine = new TriggerEngine(metrics, workflows, dedupe);
  engine.register({
    trigger_id: "t1",
    event_type: "x",
    workflow: "w1",
    dedupe: { windowMs: 60_000 },
  });
  const evt: any = {
    event_id: "e1",
    type: "x",
    timestamp: new Date().toISOString(),
    source: "test",
    payload: {},
  };
  await engine.onEvent(evt);
  await engine.onEvent(evt);
  assert.equal(calls, 1);
});
