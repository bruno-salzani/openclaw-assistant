import test from "node:test";
import assert from "node:assert/strict";
import { PolicyGateway } from "../../agents/security/policy-gateway.js";
import { PolicyService } from "../../security/policy-service.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { EventBus } from "../../infra/event-bus.js";

test("PolicyGateway emits policy.deny for sensitive ops", async () => {
  const metrics = new MetricsRegistry();
  const bus = new EventBus();
  const memory: any = { add: async () => {} };
  const deps: any = { metrics, bus, memory };
  deps.policy = new PolicyService({ metrics, bus, memory });
  const pg = new PolicyGateway(deps);
  const fired = new Promise<boolean>((resolve) => {
    const handler = (p: any) => {
      if (!p || typeof p !== "object") return;
      if (p.tool !== "terminal.exec") return;
      bus.off("policy.deny", handler);
      resolve(true);
    };
    bus.on("policy.deny", handler);
  });
  const res = pg.evaluate("terminal.exec", { cmd: "rm -rf /" }, "user");
  assert.equal(res.requireConfirmation, true);
  const ok = await Promise.race([
    fired,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(ok, true);
});

test("PolicyService: service self_test runner is deny by default", async () => {
  delete process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER;
  const metrics = new MetricsRegistry();
  const bus = new EventBus();
  const memory: any = { add: async () => {} };
  const policy = new PolicyService({ metrics, bus, memory });
  const d = policy.evaluateTool(
    "terminal.run",
    { command: "npm test" },
    { userRole: "service", source: "self_test" }
  );
  assert.equal(d.allowed, false);
});

test("PolicyService: service self_test runner allowlisted for npm test when enabled", async () => {
  process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER = "1";
  const metrics = new MetricsRegistry();
  const bus = new EventBus();
  const memory: any = { add: async () => {} };
  const policy = new PolicyService({ metrics, bus, memory });
  const d = policy.evaluateTool(
    "terminal.run",
    { command: "npm test" },
    { userRole: "service", source: "self_test" }
  );
  assert.equal(d.allowed, true);
  delete process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER;
});
