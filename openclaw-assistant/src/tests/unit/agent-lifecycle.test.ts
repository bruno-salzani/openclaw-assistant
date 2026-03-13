import test from "node:test";
import assert from "node:assert/strict";
import { AgentLifecycle, AgentLifecycleState } from "../../agents/runtime/lifecycle.js";

test("AgentLifecycle enforces valid transitions and persists lifecycle states", async () => {
  const saved: any[] = [];
  const emitted: any[] = [];
  const memory: any = { saveAgentState: async (s: any) => saved.push(s) };
  const bus: any = { emit: (t: string, p: any) => emitted.push({ t, p }) };

  const lc = new AgentLifecycle(
    { memory, bus },
    { taskId: "t1", agentName: "coordinator", traceId: "tr1", contextHash: "h1" }
  );

  await lc.init({ a: 1 });
  await lc.plan({ b: 2 });
  await lc.execute({ c: 3 });
  await lc.review({ d: 4 });
  await lc.finalize({ e: 5 });

  assert.deepEqual(
    saved.map((s) => s.step),
    [
      AgentLifecycleState.INIT,
      AgentLifecycleState.PLAN,
      AgentLifecycleState.EXECUTE,
      AgentLifecycleState.REVIEW,
      AgentLifecycleState.FINALIZE,
    ]
  );
  assert.equal(saved[saved.length - 1]!.status, "completed");
  assert.ok(emitted.some((e) => e.t === "agent.lifecycle"));
});

test("StateMachine rejects invalid lifecycle transitions", async () => {
  const memory: any = { saveAgentState: async () => {} };
  const lc = new AgentLifecycle({ memory }, { taskId: "t1", agentName: "coordinator" });
  await lc.init();
  await assert.rejects(() => lc.review(), /invalid transition/i);
});

