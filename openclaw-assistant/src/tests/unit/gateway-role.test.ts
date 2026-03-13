import test from "node:test";
import assert from "node:assert/strict";
import { CoreGateway } from "../../gateway/core-gateway.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";

test("CoreGateway: ignora metadata.userRole e usa message.userRole", async () => {
  process.env.OPENCLAW_X_PORT = "0";

  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);

  let lastUserRole: unknown;

  const gateway = new CoreGateway({
    orchestrator: {
      run: async (ctx: any) => {
        lastUserRole = ctx.userRole;
        return { text: "ok", meta: {} };
      },
    } as any,
    workflows: {} as any,
    memory: { add: () => {} } as any,
    skills: {} as any,
    tools: {} as any,
    graph: {} as any,
    tracer,
    metrics,
    queue: {
      stats: async () => ({ pending: 0, running: 0, completed: 0, failed: 0 }),
      snapshot: async () => ({ tasks: [], results: [] }),
    } as any,
    triggers: { onEvent: async () => {} } as any,
  });

  await gateway.start();

  await gateway.handleMessage({
    sessionId: "s1",
    userId: "u1",
    channel: "test",
    modality: "text",
    text: "hi",
    metadata: { userRole: "admin" },
  });
  assert.equal(lastUserRole, "user");

  await gateway.handleMessage({
    sessionId: "s2",
    userId: "u1",
    channel: "test",
    userRole: "admin",
    modality: "text",
    text: "hi",
  });
  assert.equal(lastUserRole, "admin");

  await gateway.stop();
});
