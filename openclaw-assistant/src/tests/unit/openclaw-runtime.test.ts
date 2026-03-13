import test from "node:test";
import assert from "node:assert/strict";
import { OpenClawRuntime } from "../../openclaw/runtime/runtime-adapter.js";
import { TaskStore } from "../../openclaw/runtime/task-store.js";

test("OpenClawRuntime: creates task, executes agent, persists and resumes", async () => {
  const store = new TaskStore();
  let calls = 0;
  const runtime = new OpenClawRuntime({
    store,
    agents: {
      demo: {
        name: "demo",
        execute: async (input) => {
          calls += 1;
          return { ok: true, taskId: input.taskId, echo: input.context };
        },
      },
    },
  });

  const out = await runtime.run("demo", { taskId: "t1", context: { x: 1 } });
  assert.deepEqual(out, { ok: true, taskId: "t1", echo: { x: 1 } });
  assert.equal(store.get("t1")?.status, "completed");
  assert.equal(calls, 1);

  const resumed = await runtime.resume("t1");
  assert.deepEqual(resumed, out);
  assert.equal(calls, 1);
});

test("OpenClawRuntime: resume reruns if not completed", async () => {
  const store = new TaskStore();
  const runtime = new OpenClawRuntime({
    store,
    agents: {
      demo: {
        name: "demo",
        execute: async (input) => ({ ok: true, taskId: input.taskId }),
      },
    },
  });
  store.save({
    id: "t2",
    agentName: "demo",
    context: { y: 2 },
    status: "failed",
    attempts: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const out = await runtime.resume("t2");
  assert.deepEqual(out, { ok: true, taskId: "t2" });
  assert.equal(store.get("t2")?.status, "completed");
});
