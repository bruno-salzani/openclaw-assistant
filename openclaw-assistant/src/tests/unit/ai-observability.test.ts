import test from "node:test";
import assert from "node:assert/strict";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";
import { EventBus } from "../../infra/event-bus.js";
import { AgentTracker, wrapLlmProvider } from "../../observability/agent-tracker.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";

test("AgentTracker: emits ai.observability with tool call counts and token estimates", async () => {
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const bus = new EventBus();
  const tracker = new AgentTracker({ metrics, tracer, bus });

  const tools = new ToolExecutionEngine(metrics);
  tools.setAgentTracker(tracker);
  tools.registerTool("demo", async () => ({ ok: true }));

  let evt: any = null;
  bus.once("ai.observability", (p) => {
    evt = p;
  });

  const llm = wrapLlmProvider({
    base: { name: "fake", chat: async () => "ok" },
    model: "fake-model",
    tracker,
  });

  await tracker.trackAgent(
    "planner",
    { sessionId: "s", userId: "u", channel: "t", text: "x", metadata: { traceId: "tr" } } as any,
    async () => {
      await tools.execute("demo", {}, { permissions: ["*"], userRole: "admin" });
      await llm.chat({ messages: [{ role: "user", content: "hello" }] });
    }
  );

  assert.ok(evt);
  assert.equal(evt.agent, "planner");
  assert.equal(evt.toolCalls, 1);
  assert.ok(evt.tokens.total >= 1);
  const recent = tracker.listRecent({ limit: 10, agent: "planner" });
  assert.ok(recent.length >= 1);
});
