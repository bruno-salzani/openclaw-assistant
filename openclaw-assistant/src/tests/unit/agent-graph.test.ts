import test from "node:test";
import assert from "node:assert/strict";
import { AgentGraph } from "../../agents/graph/agent-graph.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("AgentGraph: executes by dependency levels and runs same-level nodes in parallel", async () => {
  const ctx = {
    sessionId: "s",
    userId: "u",
    userRole: "user" as const,
    channel: "test",
    text: "hello",
    metadata: {},
  };

  const started: string[] = [];
  const finished: string[] = [];

  const g = new AgentGraph({
    nodes: [
      {
        id: "a",
        run: async () => {
          started.push("a");
          await sleep(120);
          finished.push("a");
          return "A";
        },
      },
      {
        id: "b",
        run: async () => {
          started.push("b");
          await sleep(120);
          finished.push("b");
          return "B";
        },
      },
      {
        id: "c",
        run: async (_ctx, inputs) => {
          started.push("c");
          finished.push("c");
          return `${inputs.a}-${inputs.b}`;
        },
      },
    ],
    edges: [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ],
  });

  const t0 = Date.now();
  const out = await g.execute(ctx as any);
  const dt = Date.now() - t0;

  assert.deepEqual(out.levels, [["a", "b"], ["c"]]);
  assert.equal(out.resultsByNodeId.c, "A-B");
  assert.ok(dt < 320, `expected parallel level execution, took ${dt}ms`);
  assert.deepEqual(started.slice(0, 2).sort(), ["a", "b"]);
  assert.deepEqual(finished.slice(0, 2).sort(), ["a", "b"]);
  assert.equal(finished[2], "c");
});

test("AgentGraph: throws on cycles", async () => {
  const g = new AgentGraph({
    nodes: [
      { id: "a", run: async () => "A" },
      { id: "b", run: async () => "B" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  });
  await assert.rejects(() =>
    g.execute({ sessionId: "s", userId: "u", channel: "t", text: "x" } as any)
  );
});
