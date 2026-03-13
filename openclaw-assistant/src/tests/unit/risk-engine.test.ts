import test from "node:test";
import assert from "node:assert/strict";
import { MetricsRegistry } from "../../observability/metrics.js";
import { PolicyService } from "../../security/policy-service.js";
import { EventBus } from "../../infra/event-bus.js";

test("PolicyService: RiskEngine blocks destructive terminal commands unless admin-approved", async () => {
  const prev = { ...process.env };
  process.env.IA_ASSISTANT_RISK_ENGINE_ENABLE = "1";
  process.env.IA_ASSISTANT_RISK_ENGINE_BLOCK_THRESHOLD = "0.95";
  process.env.IA_ASSISTANT_RISK_ENGINE_CONFIRM_THRESHOLD = "0.8";

  const metrics = new MetricsRegistry();
  const bus = new EventBus();
  const memory = { add: async () => {} } as any;
  const policy = new PolicyService({ metrics, memory, bus });

  const denied = policy.evaluateTool(
    "terminal.run",
    { command: "rm -rf /tmp" },
    { userRole: "user", approved: false, traceId: "t1", source: "test" }
  );
  assert.equal(denied.allowed, false);
  assert.equal(denied.requireConfirmation, true);
  assert.equal(denied.risk, "high");
  assert.ok(String(denied.reason ?? "").startsWith("risk_engine_blocked"));

  const allowed = policy.evaluateTool(
    "terminal.run",
    { command: "rm -rf /tmp" },
    { userRole: "admin", approved: true, traceId: "t2", source: "test" }
  );
  assert.equal(allowed.allowed, true);

  process.env = prev;
});

