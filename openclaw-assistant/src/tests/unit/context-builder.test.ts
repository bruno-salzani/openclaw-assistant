import test from "node:test";
import assert from "node:assert/strict";
import { AgentContextBuilder } from "../../agents/context-builder.js";
import { KnowledgeGraph } from "../../knowledge-graph/graph.js";

test("AgentContextBuilder: merges history + semantic + knowledge + tool results", async () => {
  const graph = new KnowledgeGraph({
    createCounter: () => ({ inc: () => undefined }) as any,
    createHistogram: () => ({ observe: () => undefined }) as any,
    counter: () => ({ inc: () => undefined }) as any,
    histogram: () => ({ observe: () => undefined }) as any,
    prometheus: async () => "",
  } as any);
  graph.addEntity({ id: "p1", type: "project", name: "IA Assistant", properties: { lang: "ts" } });

  const memory = {
    getSessionContext: async () => [
      { content: "oi", metadata: { role: "user" } },
      { content: "olá! como posso ajudar?", metadata: { role: "assistant" } },
    ],
    search: async () => [{ content: "memória semântica A", score: 0.9 }],
  };

  const queue = {
    snapshot: async () => ({
      tasks: [
        {
          taskId: "t1",
          traceId: "tr",
          sessionId: "s1",
          userId: "u",
          userRole: "user",
          type: "research",
          priority: "high",
          status: "completed",
          payload: {},
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      results: [{ taskId: "t1", traceId: "tr", ok: true, output: { text: "tool output" } }],
    }),
  };

  const b = new AgentContextBuilder({ memory: memory as any, graph, queue: queue as any });
  const out = await b.buildContext({ sessionId: "s1", query: "IA Assistant", userId: "u" });
  assert.ok(out.contextText.includes("[Conversation History]"));
  assert.ok(out.contextText.includes("[Semantic Memory]"));
  assert.ok(out.contextText.includes("[Relevant Knowledge]"));
  assert.ok(out.contextText.includes("[Recent Tool Results]"));
  assert.ok(out.llmMessages.length >= 1);
});
