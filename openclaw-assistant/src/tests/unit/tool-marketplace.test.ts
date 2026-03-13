import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { ToolRegistry } from "../../tools/registry/index.js";
import { loadToolMarketplace } from "../../tools/marketplace/index.js";
import { MetricsRegistry } from "../../observability/metrics.js";

test("Tool marketplace loads plugins from directory and registers tools", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);

  const prevEnv = { ...process.env };
  process.env.IA_ASSISTANT_TOOL_MARKETPLACE = "1";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tool-plugins-"));
  const root = path.join(tmp, "web-search");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "tool.json"),
    JSON.stringify(
      {
        name: "web-search",
        description: "Search the internet",
        permissions: ["network.read"],
        rateLimit: 20,
        entry: "index.js",
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, "index.js"),
    [
      "export async function handler(input) {",
      "  const query = String(input?.query ?? '');",
      "  if (!query.trim()) return { ok: false, error: 'query is required' };",
      "  return { ok: true, query, echo: true };",
      "}",
      "",
    ].join("\n")
  );

  const loaded = await loadToolMarketplace({ tools, registry, metrics, pluginsDir: tmp });
  assert.equal(loaded.loaded, 1);

  assert.ok(tools.hasTool("web-search"));
  const manifest = registry.get("web-search");
  assert.ok(manifest);
  assert.equal(manifest?.name, "web-search");
  assert.equal(manifest?.rateLimit, 20);

  const out = await tools.execute(
    "web-search",
    { query: "hello" },
    { permissions: ["*"], userRole: "admin" }
  );
  assert.equal(out.ok, true);
  assert.equal(out.query, "hello");

  process.env = prevEnv;
});

test("ToolExecutionEngine: uses manifest rateLimit when no explicit rate is provided", async () => {
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);
  const registry = new ToolRegistry();
  tools.setToolRegistry(registry);
  tools.registerTool("rate-limited", async () => ({ ok: true }));
  registry.register({
    name: "rate-limited",
    description: "x",
    permissions: [],
    rateLimit: 1,
  });
  const ok1 = await tools.execute("rate-limited", {}, { permissions: ["*"], userRole: "admin" });
  assert.equal(ok1.ok, true);
  await assert.rejects(() =>
    tools.execute("rate-limited", {}, { permissions: ["*"], userRole: "admin" })
  );
});
