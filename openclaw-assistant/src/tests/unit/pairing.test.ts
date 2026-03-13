import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PairingManager } from "../../gateway/pairing.js";

test("PairingManager: pairing flow approve allows sender", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-pairing-"));
  const pm = new PairingManager({ cwd: dir, pendingTtlMs: 60_000 });
  assert.equal(pm.isAllowed("console", "alice"), false);
  const req = pm.requestPairing("console", "alice");
  assert.equal(typeof req.code, "string");
  const approved = pm.approve(req.code);
  assert.equal(approved.ok, true);
  assert.equal(pm.isAllowed("console", "alice"), true);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
