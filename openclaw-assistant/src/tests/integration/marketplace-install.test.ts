import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createRuntime } from "../../runtime.js";

test("Marketplace: install tool and execute dynamically", async () => {
  process.env.IA_ASSISTANT_MARKETPLACE_REPO_PATH = path.resolve(process.cwd(), "openclaw-repo");

  const storePath = path.join(process.cwd(), ".ia-assistant", "marketplace.json");
  try {
    fs.rmSync(storePath, { force: true });
  } catch {}

  const rt = await createRuntime();
  try {
    const perms = ["marketplace.*", "filesystem.read", "echo-tool.*"];
    const install = await rt.tools.execute(
      "marketplace.install",
      { kind: "tool", name: "echo-tool" },
      { userRole: "admin", permissions: perms }
    );
    assert.equal(install.ok, true);

    const out = await rt.tools.execute(
      "echo-tool",
      { hello: "world" },
      { userRole: "admin", permissions: perms }
    );
    assert.deepEqual(out, { ok: true, input: { hello: "world" } });
  } finally {
    rt.stop();
    try {
      fs.rmSync(storePath, { force: true });
    } catch {}
    delete process.env.IA_ASSISTANT_MARKETPLACE_REPO_PATH;
  }
});
