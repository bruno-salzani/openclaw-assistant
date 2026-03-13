import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MetricsRegistry } from "../../observability/metrics.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { ToolRegistry } from "../../tools/registry/tool-registry.js";
import { loadOpenClawTools } from "../../openclaw/tools/loader.js";

test("OpenClaw tools loader: discovers tool, registers manifest, enforces perms", async () => {
  const prev = process.env.IA_ASSISTANT_TOOL_ENFORCE_MANIFEST_PERMS;
  process.env.IA_ASSISTANT_TOOL_ENFORCE_MANIFEST_PERMS = "1";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-openclaw-tools-"));
  try {
    const ext = path.join(tmp, "demo-tool");
    fs.mkdirSync(ext, { recursive: true });
    fs.writeFileSync(
      path.join(ext, "openclaw.plugin.json"),
      JSON.stringify(
        {
          name: "demo-tool",
          version: "1.0.0",
          type: "tool",
          description: "demo",
          permissions: ["network.read"],
          entry: "index.js",
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(ext, "index.js"),
      [
        "export default {",
        "  name: 'demo-tool',",
        "  description: 'demo',",
        "  permissions: ['network.read'],",
        "  async execute(input) { return { ok: true, echo: input?.q ?? null }; }",
        "};",
        "",
      ].join("\n")
    );

    const metrics = new MetricsRegistry();
    const engine = new ToolExecutionEngine(metrics);
    const manifests = new ToolRegistry();
    engine.setToolRegistry(manifests);

    const out = await loadOpenClawTools({
      extensionsDir: tmp,
      metrics,
      engine,
      manifestRegistry: manifests,
      bustImportCache: true,
    });
    assert.equal(out.loaded, 1);
    assert.ok(engine.hasTool("demo-tool"));
    const m = manifests.get("demo-tool");
    assert.ok(m);
    assert.deepEqual(m?.permissions, ["network.read"]);

    await assert.rejects(
      () =>
        engine.execute(
          "demo-tool",
          { q: "x" },
          { userRole: "admin", permissions: ["demo-tool.*"] }
        ),
      /missing manifest permission/i
    );
    const ok = await engine.execute(
      "demo-tool",
      { q: "x" },
      { userRole: "admin", permissions: ["demo-tool.*", "network.read"] }
    );
    assert.deepEqual(ok, { ok: true, echo: "x" });
  } finally {
    if (prev === undefined) delete process.env.IA_ASSISTANT_TOOL_ENFORCE_MANIFEST_PERMS;
    else process.env.IA_ASSISTANT_TOOL_ENFORCE_MANIFEST_PERMS = prev;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
