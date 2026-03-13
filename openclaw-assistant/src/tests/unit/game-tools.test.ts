import test from "node:test";
import assert from "node:assert/strict";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { ToolRegistry } from "../../tools/registry/tool-registry.js";
import { registerGameTools } from "../../game/tools.js";

test("Game tools: screen.capture supports mock mode", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);
  registerGameTools({ tools, registry });

  const out = await tools.execute("screen.capture", { mock: true, width: 3, height: 4 }, { permissions: ["screen.*"] });
  assert.equal(out.ok, true);
  assert.equal(out.mime, "image/png");
  assert.equal(out.width, 3);
  assert.equal(out.height, 4);
  assert.ok(typeof out.base64 === "string" && out.base64.length > 0);
});

test("Game tools: screen.detect_objects finds changes between frames", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);
  registerGameTools({ tools, registry });

  const { PNG } = await import("pngjs");
  const a = new PNG({ width: 8, height: 8 });
  a.data.fill(0);
  for (let i = 3; i < 7; i += 1) {
    const idx = (8 * 4 + i) << 2;
    a.data[idx] = 255;
    a.data[idx + 1] = 255;
    a.data[idx + 2] = 255;
    a.data[idx + 3] = 255;
  }
  const before = PNG.sync.write(new PNG({ width: 8, height: 8 }));
  const after = PNG.sync.write(a);

  const out = await tools.execute(
    "screen.detect_objects",
    { imageBase64: after.toString("base64"), previousImageBase64: before.toString("base64"), threshold: 10, step: 1 },
    { permissions: ["screen.*"] }
  );
  assert.equal(out.ok, true);
  assert.ok(out.diffScore > 0);
  assert.ok(Array.isArray(out.boxes));
  assert.ok(out.boxes.length >= 1);
});

test("Game tools: keyboard.press supports dryRun", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);
  registerGameTools({ tools, registry });

  const out = await tools.execute("keyboard.press", { dryRun: true, key: "w" }, { permissions: ["keyboard.*"] });
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
});

test("Game tools: game.get_state supports mock capture", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);
  registerGameTools({ tools, registry });

  const out = await tools.execute("game.get_state", { mock: true, width: 5, height: 6 }, { permissions: ["game.*"] });
  assert.equal(out.ok, true);
  assert.equal(out.screen.width, 5);
  assert.equal(out.screen.height, 6);
  assert.ok(typeof out.screen.base64 === "string" && out.screen.base64.length > 0);
});

