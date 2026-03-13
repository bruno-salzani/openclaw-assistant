import test from "node:test";
import assert from "node:assert/strict";
import { PatchValidator } from "../../self-improvement/patch-validator.js";

test("PatchValidator: rejeita patch com material sensível", () => {
  const validator = new PatchValidator();
  const out = validator.validateStatic(process.cwd(), {
    taskId: "t",
    title: "x",
    diff: [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@",
      "+OPENCLAW_X_ADMIN_TOKEN=secret",
      "",
    ].join("\n"),
    filesTouched: ["a.ts"],
  });

  assert.equal(out.ok, false);
  assert.equal(out.errors.includes("patch_contains_sensitive_material"), true);
});

