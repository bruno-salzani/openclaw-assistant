import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolAuditLogger } from "../../audit/tool-audit.js";

test("ToolAuditLogger: redige chaves sensíveis", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-audit-"));
  const audit = new ToolAuditLogger({ cwd: dir });
  const redacted: any = audit.redactArgs({
    token: "x",
    nested: { apiKey: "y", ok: true },
    arr: [{ password: "z" }],
  });
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.nested.apiKey, "[REDACTED]");
  assert.equal(redacted.nested.ok, true);
  assert.equal(redacted.arr[0].password, "[REDACTED]");
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
