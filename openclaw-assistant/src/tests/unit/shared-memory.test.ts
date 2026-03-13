import test from "node:test";
import assert from "node:assert/strict";
import { SharedMemory } from "../../distributed/shared-memory.js";
import { propose, resolve } from "../../distributed/consensus.js";

test("SharedMemory(memory): set/get/del/keys + locks", async () => {
  const sm = new SharedMemory({ backend: "memory", namespace: "t" });
  const e1 = await sm.set("k1", { a: 1 }, 10_000);
  assert.equal(typeof e1.updatedAt, "number");
  const got = await sm.get<{ a: number }>("k1");
  assert.equal(got?.value.a, 1);

  const keys = await sm.keys("k", 10);
  assert.deepEqual(keys.sort(), ["k1"]);

  const owner = "o1";
  const acq1 = await sm.acquireLock("l1", owner, 1000);
  assert.equal(acq1, true);
  const acq2 = await sm.acquireLock("l1", "o2", 1000);
  assert.equal(acq2, false);
  const relBad = await sm.releaseLock("l1", "o2");
  assert.equal(relBad, false);
  const relOk = await sm.releaseLock("l1", owner);
  assert.equal(relOk, true);

  const removed = await sm.del("k1");
  assert.equal(removed, 1);
  const got2 = await sm.get("k1");
  assert.equal(got2, null);
});

test("Consensus: resolve picks highest score proposal", async () => {
  const sm = new SharedMemory({ backend: "memory", namespace: "t2" });
  const p1 = await propose({ shared: sm, topic: "plan", id: "a", value: { x: 1 }, score: 0.2 });
  assert.equal(p1.ok, true);
  const p2 = await propose({ shared: sm, topic: "plan", id: "b", value: { x: 2 }, score: 0.9 });
  assert.equal(p2.ok, true);
  const out = await resolve({ shared: sm, topic: "plan" });
  assert.equal(out.ok, true);
  assert.equal(out.resolution.winner?.id, "b");
});

