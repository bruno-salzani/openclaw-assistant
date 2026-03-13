import test from "node:test";
import assert from "node:assert/strict";
import { GovernanceLayer } from "../../agents/security/governance.js";
import { MetricsRegistry } from "../../observability/metrics.js";

const deps = {
  metrics: new MetricsRegistry(),
} as any;

test("GovernanceLayer: low risk tool allows without confirmation", () => {
  const g = new GovernanceLayer(deps);
  const res = g.assess("calendar.read", {}, "user");
  assert.equal(res.risk, "low");
  assert.equal(res.requireConfirmation, false);
});

test("GovernanceLayer: high risk tool requires confirmation for non-admin", () => {
  const g = new GovernanceLayer(deps);
  const res = g.assess("terminal.exec", { cmd: "rm -rf /" }, "user");
  assert.ok(res.requireConfirmation);
  assert.ok(res.risk === "high" || res.risk === "medium");
});

test("GovernanceLayer: rate limiting triggers confirmation", () => {
  const g = new GovernanceLayer(deps);
  let flagged = false;
  for (let i = 0; i < 55; i++) {
    const res = g.assess("calendar.read", {}, "user");
    if (res.reason === "rate_limit") flagged = true;
  }
  assert.equal(flagged, true);
});
