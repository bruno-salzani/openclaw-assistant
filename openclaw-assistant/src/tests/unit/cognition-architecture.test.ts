import test from "node:test";
import assert from "node:assert/strict";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";
import { AgentTracker } from "../../observability/agent-tracker.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import { AgentProfileRegistry } from "../../cognition/agent-profile-registry.js";
import { wrapLlmWithProfiles } from "../../cognition/profiled-llm.js";
import { PerceptionEngine } from "../../cognition/perception-engine.js";
import { ReasoningEngine } from "../../cognition/reasoning-engine.js";
import { PlanningEngine } from "../../cognition/planning-engine.js";
import { ExecutionEngine } from "../../cognition/execution-engine.js";
import { KnowledgeState } from "../../world-model/knowledge-state.js";
import { PredictionEngine } from "../../world-model/prediction-engine.js";

test("Agent profiles: wrapper injeta temperature e system message baseado no agente atual", async () => {
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const tracker = new AgentTracker({ metrics, tracer });
  let sawTemperature: number | undefined;
  let sawProfileSystem = false;
  const base: LLMProvider = {
    name: "base",
    chat: async (input) => {
      sawTemperature = input.temperature;
      sawProfileSystem = input.messages.some((m) => m.role === "system" && m.content.includes("[Agent Profile]"));
      return "ok";
    },
  };
  const wrapped = wrapLlmWithProfiles({
    base,
    tracker,
    profiles: new AgentProfileRegistry({ baseDir: process.cwd() }),
  });

  await tracker.trackAgent(
    "research",
    { sessionId: "s", userId: "u", channel: "c", text: "x", metadata: {} },
    async () => wrapped.chat({ messages: [{ role: "user", content: "ping" }] })
  );

  assert.equal(sawTemperature, 0.2);
  assert.equal(sawProfileSystem, true);
});

test("Cognition pipeline: percepção + raciocínio + plano gera spawn para tarefa complexa", async () => {
  const perception = new PerceptionEngine().perceive({
    ctx: { sessionId: "s", userId: "u", channel: "c", text: "x", metadata: {} },
    text: "analyze startup market and pricing strategy with growth trends",
  });
  const world = new KnowledgeState({ memory: { add: async () => undefined } as any });
  const predictor = new PredictionEngine({});
  const reasoning = await new ReasoningEngine({ world: { state: world, predictor } }).reason(perception);
  const plan = new PlanningEngine().plan(perception, reasoning);
  assert.equal(plan.strategy, "planning");
  assert.ok(plan.spawn.length >= 2);
  assert.ok(plan.spawn.some((s) => s.role === "research"));
});

test("ExecutionEngine: executa spawn em paralelo e concatena contextText", async () => {
  const exec = new ExecutionEngine();
  const out = await exec.runSpawn({
    ctx: { sessionId: "s", userId: "u", channel: "c", text: "x", metadata: {} },
    plan: {
      strategy: "planning",
      spawn: [
        { id: "a", role: "research", prompt: "p1" },
        { id: "b", role: "analyst", prompt: "p2" },
      ],
    },
    runAgent: async (role) => ({ text: `ok:${role}` }),
  });
  assert.equal(out.spawnRuns.length, 2);
  assert.ok(out.contextText.includes("[Swarm:a:research]"));
  assert.ok(out.contextText.includes("ok:research"));
});
