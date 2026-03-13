import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { AgentRegistry } from "../../agent-factory/agent-registry.js";
import { extractCapabilitiesHeuristic, detectCapabilityGap } from "../../agent-factory/capability-detector.js";
import { designAgentBlueprint } from "../../agent-factory/agent-designer.js";
import { validateAgentBlueprint } from "../../agent-factory/agent-validator.js";

test("AgentFactory capability detector extracts expected capabilities", async () => {
  const caps = extractCapabilitiesHeuristic("extract clauses from legal contract pdf");
  assert.ok(caps.includes("pdf-parsing"));
  assert.ok(caps.includes("legal-nlp"));
  assert.ok(caps.includes("clause-extraction"));
});

test("AgentRegistry finds capability gaps when no agent matches", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-agent-reg-"));
  const registry = new AgentRegistry(tmp);
  const gap = await detectCapabilityGap({
    task: "extract clauses from legal contract pdf",
    registry,
  });
  assert.ok(gap);
  assert.ok(gap!.requiredCapabilities.length > 0);
});

test("AgentDesigner produces a blueprint with normalized name and memory selection", async () => {
  const bp = designAgentBlueprint({
    name: "Legal Analysis Agent",
    requiredCapabilities: ["legal-nlp", "pdf-parsing", "clause-extraction"],
  });
  assert.equal(bp.name, "legal-analysis-agent");
  assert.ok(bp.capabilities.includes("legal-nlp"));
});

test("AgentValidator rejects invalid memory value", async () => {
  const res = validateAgentBlueprint({
    blueprint: {
      name: "x",
      description: "y",
      capabilities: [],
      tools: [],
      skills: [],
      memory: "bad" as any,
    },
  });
  assert.equal(res.ok, false);
});

