import test from "node:test";
import assert from "node:assert/strict";
import { LLMRouter } from "../../llm/router.js";
import type { LLMProvider } from "../../llm/llm-provider.js";

function provider(name: string): LLMProvider {
  return {
    name,
    chat: async () => name,
  };
}

test("LLMRouter: routes coding prompts to coding provider", async () => {
  const r = new LLMRouter({
    cheap: provider("cheap"),
    reasoning: provider("reasoning"),
    coding: provider("coding"),
  });
  const out = await r.chat({
    messages: [{ role: "user", content: "Corrija este código:\n```ts\nconst x: any = 1\n```" }],
  });
  assert.equal(out, "coding");
});

test("LLMRouter: routes long prompts to reasoning provider", async () => {
  const r = new LLMRouter({
    cheap: provider("cheap"),
    reasoning: provider("reasoning"),
    coding: provider("coding"),
  });
  const out = await r.chat({
    messages: [{ role: "user", content: "a".repeat(1200) }],
  });
  assert.equal(out, "reasoning");
});

test("LLMRouter: routes short non-coding prompts to cheap provider", async () => {
  const r = new LLMRouter({
    cheap: provider("cheap"),
    reasoning: provider("reasoning"),
    coding: provider("coding"),
  });
  const out = await r.chat({
    messages: [{ role: "user", content: "Olá, qual a capital do Brasil?" }],
  });
  assert.equal(out, "cheap");
});

test("LLMRouter: compacts large context with summarization using cheap provider", async () => {
  const prev = { ...process.env };
  process.env.IA_ASSISTANT_LLM_SUMMARIZE = "1";
  process.env.IA_ASSISTANT_LLM_MAX_CONTEXT_CHARS = "300";
  process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS = "100";
  process.env.IA_ASSISTANT_LLM_SYSTEM_CONTEXT_MAX_CHARS = "200";
  process.env.IA_ASSISTANT_LLM_SUMMARY_KEEP_LAST = "4";
  let summaryCalls = 0;
  let reasoningCalls = 0;
  let sawSummary = false;
  const cheap: LLMProvider = {
    name: "cheap",
    chat: async () => {
      summaryCalls += 1;
      return "resumo";
    },
  };
  const reasoning: LLMProvider = {
    name: "reasoning",
    chat: async (input) => {
      reasoningCalls += 1;
      sawSummary = input.messages.some(
        (m) => m.role === "system" && m.content.includes("[Conversation Summary]")
      );
      return "ok";
    },
  };
  const r = new LLMRouter({ cheap, reasoning, default: reasoning, coding: provider("coding") });
  const bigHistory = Array.from({ length: 40 }).map((_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg ${i} ` + "x".repeat(50),
  }));
  const out = await r.chat({
    messages: [
      { role: "system", content: "context" },
      ...bigHistory,
      { role: "user", content: "ping" },
    ],
  });
  assert.equal(out, "ok");
  assert.ok(summaryCalls >= 1);
  assert.equal(reasoningCalls, 1);
  assert.ok(sawSummary);
  process.env = prev;
});

test("LLMRouter: falls back to relevance truncation when summarization fails", async () => {
  const prev = { ...process.env };
  process.env.IA_ASSISTANT_LLM_SUMMARIZE = "1";
  process.env.IA_ASSISTANT_LLM_MAX_CONTEXT_CHARS = "320";
  process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS = "0";
  process.env.IA_ASSISTANT_LLM_SYSTEM_CONTEXT_MAX_CHARS = "120";
  process.env.IA_ASSISTANT_LLM_SUMMARY_KEEP_LAST = "2";
  let cheapCalls = 0;
  let reasoningCalls = 0;
  let sawDecision = false;
  const cheap: LLMProvider = {
    name: "cheap",
    chat: async () => {
      cheapCalls += 1;
      throw new Error("summarizer failed");
    },
  };
  const reasoning: LLMProvider = {
    name: "reasoning",
    chat: async (input) => {
      reasoningCalls += 1;
      sawDecision = input.messages.some((m) => m.content.includes("DECISION:"));
      return "ok";
    },
  };
  const r = new LLMRouter({ cheap, reasoning, default: reasoning, coding: provider("coding") });
  const filler = Array.from({ length: 30 }).map((_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `filler ${i} ` + "x".repeat(40),
  }));
  const messages = [
    { role: "system", content: "context" },
    ...filler.slice(0, 8),
    { role: "assistant", content: "DECISION: Use Postgres for long-term memory." },
    ...filler.slice(8),
    { role: "user", content: "ping" },
    { role: "assistant", content: "pong" },
  ];
  const out = await r.chat({ messages });
  assert.equal(out, "ok");
  assert.ok(cheapCalls >= 1);
  assert.equal(reasoningCalls, 1);
  assert.ok(sawDecision);
  process.env = prev;
});
