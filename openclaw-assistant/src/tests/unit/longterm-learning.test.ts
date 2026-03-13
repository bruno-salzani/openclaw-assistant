import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventBus } from "../../infra/event-bus.js";
import { ImprovementEngine } from "../../learning/improvement-engine.js";

test("ImprovementEngine collects failures and exports a JSONL dataset", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-learning-"));
  const bus = new EventBus();
  const memory: any = { add: async () => undefined };
  const engine = new ImprovementEngine({ bus, memory, baseDir: tmp });
  engine.start();

  bus.emit("tool.executed", {
    tool: "demo.fail",
    ok: false,
    durationMs: 123,
    error: "boom",
    traceId: "t1",
    workspaceId: "ws:x",
    ts: Date.now(),
  });
  bus.emit("ai.observability", {
    agent: "planner",
    sessionId: "s1",
    traceId: "t1",
    latencyMs: 999,
    toolCalls: 1,
    tokens: { total: 10 },
    costUsd: 0,
    ok: false,
  });

  engine.recordUserCorrection({
    sessionId: "s1",
    userId: "u1",
    traceId: "t1",
    prompt: "P",
    answer: "A",
    correction: "C",
  });

  const stats = engine.stats(1000);
  assert.ok(stats.events >= 2);

  const out = engine.exportTrainingDataset({ limit: 1000 });
  assert.equal(out.ok, true);
  assert.ok(fs.existsSync(out.filePath));
  const raw = fs.readFileSync(out.filePath, "utf-8");
  assert.ok(raw.trim().length > 0);
});

