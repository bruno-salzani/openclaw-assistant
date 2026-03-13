import test from "node:test";
import assert from "node:assert/strict";
import { detectStuckAgents, detectLoopingAgents } from "../../runtime/health-check.js";

test("detectStuckAgents finds running states older than threshold", async () => {
  const now = 1_000_000;
  const states: any[] = [
    { taskId: "t1", agentName: "a1", step: "EXECUTE", status: "running", updatedAt: now - 10_000 },
    { taskId: "t2", agentName: "a2", step: "PLAN", status: "running", updatedAt: now - 100 },
  ];
  const stuck = detectStuckAgents({ now, states, stuckAfterMs: 5_000 });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.state.taskId, "t1");
});

test("detectLoopingAgents flags when last step repeats in checkpoints window", async () => {
  const mk = (step: string) => ({ taskId: "t1", agentName: "coordinator", step, status: "running" });
  const cps = [
    mk("INIT"),
    mk("PLAN"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
    mk("EXECUTE"),
  ];
  const m = new Map<string, any[]>();
  m.set("t1:coordinator", cps);
  const looping = detectLoopingAgents({ checkpointsByAgent: m as any });
  assert.equal(looping.length, 1);
  assert.equal(looping[0]!.state.step, "EXECUTE");
});

