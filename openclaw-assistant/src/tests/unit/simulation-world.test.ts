import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SimulationEnvironment } from "../../simulation/environment.js";

test("SimulationEnvironment: persistent world increments tick across instances", () => {
  const prev = { ...process.env };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-sim-"));
  process.env.IA_ASSISTANT_SIMULATION_WORLD_DIR = tmp;

  const env1 = new SimulationEnvironment({ seed: 1, worldId: "w1", persistWorld: true });
  assert.equal(env1.getWorld().tick, 0);
  env1.tick();
  env1.tick();
  assert.equal(env1.getWorld().tick, 2);

  const env2 = new SimulationEnvironment({ seed: 1, worldId: "w1", persistWorld: true });
  assert.equal(env2.getWorld().tick, 2);
  env2.tick();
  assert.equal(env2.getWorld().tick, 3);

  process.env = prev;
});

