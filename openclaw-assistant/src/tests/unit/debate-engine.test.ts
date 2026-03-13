import test from "node:test";
import assert from "node:assert/strict";
import { runDebate } from "../../reasoning/debate-engine.js";

test("DebateEngine returns a winner and ranking", async () => {
  const out = await runDebate({ task: "Implement a safe feature flag with tests", variants: 3 });
  assert.ok(out.winner);
  assert.equal(out.proposals.length, 3);
  assert.ok(out.ranking.length >= 1);
});

