import test from "node:test";
import assert from "node:assert/strict";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { EventBus } from "../../infra/event-bus.js";

test("ToolExecutionEngine: executes a simple tool with permissions", async () => {
  const m = new MetricsRegistry();
  const engine = new ToolExecutionEngine(m);
  engine.registerTool("echo.ok", async (input) => ({ ok: true, input }));
  const out = await engine.execute("echo.ok", { foo: 1 }, { permissions: ["*"] });
  assert.equal(out.ok, true);
});

test("ToolExecutionEngine: denies when no permissions provided", async () => {
  const m = new MetricsRegistry();
  const engine = new ToolExecutionEngine(m);
  engine.registerTool("echo.ok", async (input) => ({ ok: true, input }));
  await assert.rejects(() => engine.execute("echo.ok", { foo: 1 }), /Permission denied/);
});

test("ToolExecutionEngine: caching returns same result within ttl", async () => {
  const m = new MetricsRegistry();
  const engine = new ToolExecutionEngine(m);
  let calls = 0;
  engine.registerTool("calc.add", async (input: any) => {
    calls += 1;
    return input.a + input.b;
  });
  const opts = { permissions: ["*"], cacheTtlMs: 1000 };
  const r1 = await engine.execute("calc.add", { a: 1, b: 2 }, opts);
  const r2 = await engine.execute("calc.add", { a: 1, b: 2 }, opts);
  assert.equal(r1, 3);
  assert.equal(r2, 3);
  assert.equal(calls, 1);
});

test("ToolExecutionEngine: circuit breaker opens after consecutive errors", async () => {
  const m = new MetricsRegistry();
  const bus = new EventBus();
  const engine = new ToolExecutionEngine(m);
  engine.setBus(bus);
  engine.registerTool("unstable.boom", async () => {
    throw new Error("boom");
  });
  let errorEvents = 0;
  bus.on("tool.error", () => {
    errorEvents += 1;
  });
  const opts = { permissions: ["*"] as string[] };
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => engine.execute("unstable.boom", {}, opts));
  }
  await assert.rejects(() => engine.execute("unstable.boom", {}, opts), /Circuit open/);
  assert.ok(errorEvents >= 5);
});

test("ToolExecutionEngine: rate limiting enforces per tool", async () => {
  const m = new MetricsRegistry();
  const engine = new ToolExecutionEngine(m);
  engine.registerTool("cheap.noop", async () => "ok");
  const opts = { permissions: ["*"], rate: { perMin: 2 } };
  await engine.execute("cheap.noop", {}, opts);
  await engine.execute("cheap.noop", {}, opts);
  await assert.rejects(() => engine.execute("cheap.noop", {}, opts), /Rate limit/);
});
