import test from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../../infra/event-bus.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { SkillMarketplace } from "../../skills/marketplace.js";
import { InMemoryTaskQueue } from "../../tasks/inmemory-queue.js";
import { defaultFirewall } from "../../security/instruction-firewall.js";
import { AutonomousScheduler } from "../../autonomous/scheduler.js";

test("AutonomousScheduler runs agent on event trigger and enforces no parallel runs", async () => {
  const bus = new EventBus();
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const tools = new ToolExecutionEngine(metrics);
  const skills = new SkillMarketplace(metrics);
  const queue = new InMemoryTaskQueue();
  const memory: any = { add: async () => {} };

  const deps: any = {
    tools,
    memory,
    skills,
    graph: {} as any,
    tracer,
    metrics,
    firewall: defaultFirewall,
    queue,
    bus,
  };

  const scheduler = new AutonomousScheduler({ bus, workspaceId: "ws:test" });

  let calls = 0;
  let maxParallel = 0;
  let parallel = 0;
  scheduler.register({
    id: "demo",
    description: "demo",
    triggers: [{ kind: "event", topic: "demo.event" }],
    run: async () => {
      calls += 1;
      parallel += 1;
      maxParallel = Math.max(maxParallel, parallel);
      await new Promise((r) => setTimeout(r, 20));
      parallel -= 1;
    },
  });

  scheduler.start(deps);
  bus.emit("demo.event", { x: 1 });
  bus.emit("demo.event", { x: 2 });
  await new Promise((r) => setTimeout(r, 60));
  scheduler.stop();

  assert.equal(calls, 1);
  assert.equal(maxParallel, 1);
});

test("AutonomousScheduler triggers goal agents", async () => {
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const deps: any = {
    tools: new ToolExecutionEngine(metrics),
    memory: { add: async () => {} },
    skills: new SkillMarketplace(metrics),
    graph: {} as any,
    tracer,
    metrics,
    firewall: defaultFirewall,
    queue: new InMemoryTaskQueue(),
    bus: new EventBus(),
  };
  const scheduler = new AutonomousScheduler({ bus: deps.bus, workspaceId: "ws:test" });
  let calls = 0;
  scheduler.register({
    id: "goal-demo",
    description: "goal demo",
    triggers: [{ kind: "goal", name: "reduce_cost" }],
    run: async () => {
      calls += 1;
    },
  });
  scheduler.start(deps);
  await scheduler.triggerGoal(deps, "reduce_cost", { p: 1 });
  scheduler.stop();
  assert.equal(calls, 1);
});

