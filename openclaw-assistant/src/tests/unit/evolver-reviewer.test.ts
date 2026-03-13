import test from "node:test";
import assert from "node:assert/strict";
import { PatchReviewer } from "../../evolver/reviewer.js";
import { Evaluator } from "../../evolver/evaluator.js";

test("PatchReviewer: rejeita patch com material sensível", async () => {
  const reviewer = new PatchReviewer();
  const r = reviewer.review({
    taskId: "t",
    title: "x",
    diff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@\nOPENCLAW_X_ADMIN_TOKEN=secret\n",
    filesTouched: ["a"],
  });
  assert.equal(r.approved, false);
  assert.equal(r.reasons.includes("patch_contains_sensitive_material"), true);
});

test("Evaluator: rejeita quando testes falham", async () => {
  const ev = new Evaluator();
  const out = ev.evaluate({
    tests: { ok: false, exitCode: 1, stdout: "", stderr: "fail", durationMs: 1 },
  });
  assert.equal(out.accept, false);
  assert.equal(out.reasons.includes("tests_failed"), true);
});
