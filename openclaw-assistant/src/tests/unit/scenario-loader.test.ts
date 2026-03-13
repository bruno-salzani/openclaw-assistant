import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { loadScenarioFromFile } from "../../simulation/scenario-loader.js";

test("ScenarioLoader parses minimal YAML scenario", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-scn-"));
  const p = path.join(tmp, "s.yaml");
  fs.writeFileSync(
    p,
    [
      "name: demo",
      "tasks:",
      "  - text: \"hello\"",
      "    userRole: \"user\"",
      "  - text: \"admin task\"",
      "    userRole: \"admin\"",
      "",
    ].join("\n")
  );
  const s = loadScenarioFromFile(p);
  assert.equal(s.name, "demo");
  assert.equal(s.tasks.length, 2);
  assert.equal(s.tasks[1]!.userRole, "admin");
});

