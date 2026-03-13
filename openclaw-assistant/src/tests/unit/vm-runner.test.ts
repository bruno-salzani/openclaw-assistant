import test from "node:test";
import assert from "node:assert/strict";
import { runJsInVm } from "../../sandbox/vm-runner.js";

test("runJsInVm executes code with input and returns output", async () => {
  const r = await runJsInVm({
    code: "return { y: (input?.x ?? 0) + 1 };",
    input: { x: 41 },
    timeoutMs: 500,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.output, { y: 42 });
});
