import test from "node:test";
import assert from "node:assert/strict";
import { planWithTreeOfThought } from "../../reasoning/tree-of-thought.js";
import { reflexionReviseAnswer } from "../../reasoning/reflexion.js";

test("Tree of Thoughts: returns a normalized plan with steps", async () => {
  const llm = {
    name: "fake",
    chat: async (input: any) => {
      const s = String(input?.messages?.[1]?.content ?? "");
      if (s.includes('"plans"')) {
        return JSON.stringify({
          plans: [
            { steps: [{ id: "r1", type: "research", dependsOn: [], payload: { query: "x" } }] },
            { steps: [{ id: "e1", type: "execute", dependsOn: [], payload: { action: "y" } }] },
          ],
        });
      }
      if (s.includes('"scores"')) {
        return JSON.stringify({ scores: [9, 3] });
      }
      return JSON.stringify({ plans: [] });
    },
  };

  const out = await planWithTreeOfThought({
    llm: llm as any,
    objective: "x",
    depth: 1,
    branches: 2,
  });
  assert.ok(Array.isArray(out.plan.steps));
  assert.equal(out.plan.steps[0].id, "r1");
  assert.equal(out.plan.steps[0].type, "research");
});

test("Reflexion: revises answer when JSON is returned", async () => {
  const llm = {
    name: "fake",
    chat: async () => JSON.stringify({ critique: "too short", revised: "better answer" }),
  };
  const out = await reflexionReviseAnswer({ llm: llm as any, prompt: "p", answer: "a" });
  assert.equal(out.revised, "better answer");
});
