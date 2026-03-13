import test from "node:test";
import assert from "node:assert/strict";

import { validateLearnedSkill } from "../../agent-learning/skill-validator.js";
import { buildLearnedSkillTool } from "../../agent-learning/skill-trainer.js";

test("SkillValidator blocks risky tools by default", async () => {
  const res = validateLearnedSkill({
    spec: {
      id: "x",
      description: "y",
      steps: [{ tool: "terminal.run", argsTemplate: { command: "{{input.command}}" } }] as any,
    },
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("risky tool")));
});

test("SkillTrainer supports '$' passthrough argsTemplate", async () => {
  const calls: any[] = [];
  const deps: any = {
    tools: {
      execute: async (tool: string, args: any, ctx: any) => {
        calls.push({ tool, args, ctx });
        return { ok: true };
      },
    },
  };

  const built = buildLearnedSkillTool({
    deps,
    spec: {
      id: "pdf-table-extraction",
      description: "macro",
      steps: [{ tool: "filesystem.read_file", argsTemplate: { $: "{{input.args}}" } }] as any,
    },
  });

  const out = await (built.handler as any)(
    { args: { path: "x.pdf" } },
    { userRole: "admin", permissions: ["*"], workspaceId: "ws:x", traceId: "t1" }
  );

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.args, { path: "x.pdf" });
});

