import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentContext } from "../agents/types.js";
import type { EventBus } from "../infra/event-bus.js";
import type { MetricsRegistry } from "./metrics.js";
import type { Tracer } from "./tracing.js";
import { LatencyTimer } from "./latency.js";
import {
  estimateCostUsd,
  estimateTokensFromMessages,
  estimateTokensFromText,
} from "./token-usage.js";
import type { LLMMessage, LLMProvider } from "../llm/llm-provider.js";

export type AgentObsEvent = {
  agent: string;
  sessionId: string;
  traceId?: string;
  ts?: number;
  latencyMs: number;
  toolCalls: number;
  model?: string;
  llmCalls?: number;
  tokens: { prompt: number; completion: number; total: number };
  costUsd: number;
  ok: boolean;
};

type Store = {
  agent: string;
  sessionId: string;
  traceId?: string;
  startedAt: number;
  toolCalls: number;
  model?: string;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export class AgentTracker {
  private readonly als = new AsyncLocalStorage<Store>();

  private readonly events: AgentObsEvent[] = [];

  constructor(
    private readonly deps: {
      metrics: MetricsRegistry;
      tracer: Tracer;
      bus?: EventBus;
    }
  ) {
    deps.metrics.createHistogram(
      "ai_agent_latency_ms",
      "Agent latency in ms",
      [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
    );
    deps.metrics.createCounter("ai_agent_tool_calls_total", "Tool calls attributed to agents");
    deps.metrics.createCounter("ai_agent_tokens_total", "Estimated tokens attributed to agents");
    deps.metrics.createCounter("ai_agent_cost_usd_total", "Estimated cost attributed to agents");
    deps.metrics.createHistogram(
      "ai_llm_latency_ms",
      "LLM latency in ms",
      [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
    );
  }

  private maxBufferSize() {
    const v = Number(process.env.IA_ASSISTANT_AI_OBS_BUFFER ?? 200);
    if (!Number.isFinite(v) || v <= 0) return 200;
    return Math.min(10_000, Math.floor(v));
  }

  private pushEvent(evt: AgentObsEvent) {
    this.events.push(evt);
    const max = this.maxBufferSize();
    if (this.events.length > max) this.events.splice(0, this.events.length - max);
  }

  current() {
    return this.als.getStore();
  }

  listRecent(params?: { limit?: number; agent?: string; sessionId?: string; traceId?: string }) {
    const limitRaw = params?.limit ?? 50;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50;
    const agent = params?.agent ? String(params.agent) : "";
    const sessionId = params?.sessionId ? String(params.sessionId) : "";
    const traceId = params?.traceId ? String(params.traceId) : "";
    const filtered = this.events.filter((e) => {
      if (agent && e.agent !== agent) return false;
      if (sessionId && e.sessionId !== sessionId) return false;
      if (traceId && e.traceId !== traceId) return false;
      return true;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  statsByAgent() {
    const by: Record<
      string,
      {
        runs: number;
        ok: number;
        fail: number;
        avgLatencyMs: number;
        toolCalls: number;
        tokens: number;
        costUsd: number;
      }
    > = {};
    for (const e of this.events) {
      const k = e.agent;
      const cur =
        by[k] ??
        (by[k] = {
          runs: 0,
          ok: 0,
          fail: 0,
          avgLatencyMs: 0,
          toolCalls: 0,
          tokens: 0,
          costUsd: 0,
        });
      cur.runs += 1;
      if (e.ok) cur.ok += 1;
      else cur.fail += 1;
      cur.toolCalls += e.toolCalls;
      cur.tokens += e.tokens.total;
      cur.costUsd += e.costUsd;
      cur.avgLatencyMs += (e.latencyMs - cur.avgLatencyMs) / cur.runs;
    }
    return by;
  }

  recordToolCall() {
    const s = this.als.getStore();
    if (!s) return;
    s.toolCalls += 1;
    this.deps.metrics.counter("ai_agent_tool_calls_total").inc();
  }

  recordLlmUsage(params: { model?: string; messages: LLMMessage[]; outputText: string }) {
    const s = this.als.getStore();
    if (!s) return;
    s.model = params.model;
    s.llmCalls += 1;
    const promptTokens = estimateTokensFromMessages(params.messages);
    const completionTokens = estimateTokensFromText(params.outputText);
    s.promptTokens += promptTokens;
    s.completionTokens += completionTokens;
    const cost = estimateCostUsd({
      model: params.model,
      promptTokens,
      completionTokens,
    });
    s.costUsd += cost;
    this.deps.metrics.counter("ai_agent_tokens_total").inc(promptTokens + completionTokens);
    if (cost > 0) this.deps.metrics.counter("ai_agent_cost_usd_total").inc(cost);
  }

  recordLlmLatency(ms: number) {
    this.deps.metrics.histogram("ai_llm_latency_ms").observe(ms);
  }

  async trackAgent<T>(agent: string, ctx: AgentContext, fn: () => Promise<T>): Promise<T> {
    const traceId =
      typeof (ctx.metadata as any)?.traceId === "string"
        ? String((ctx.metadata as any).traceId)
        : undefined;
    const store: Store = {
      agent,
      sessionId: ctx.sessionId,
      traceId,
      startedAt: Date.now(),
      toolCalls: 0,
      llmCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };

    const timer = new LatencyTimer();
    const span = this.deps.tracer.startSpan(`ai.agent.${agent}`, {
      sessionId: ctx.sessionId,
      traceId: traceId ?? "",
      agent,
    });

    try {
      const out = await this.als.run(store, fn);
      const evt: AgentObsEvent = {
        agent,
        sessionId: ctx.sessionId,
        traceId,
        ts: Date.now(),
        latencyMs: timer.elapsedMs(),
        toolCalls: store.toolCalls,
        model: store.model,
        llmCalls: store.llmCalls,
        tokens: {
          prompt: store.promptTokens,
          completion: store.completionTokens,
          total: store.promptTokens + store.completionTokens,
        },
        costUsd: store.costUsd,
        ok: true,
      };
      this.deps.metrics.histogram("ai_agent_latency_ms").observe(evt.latencyMs);
      this.pushEvent(evt);
      if (String(process.env.IA_ASSISTANT_AI_OBS_LOG ?? "0") === "1") {
        const format = String(process.env.IA_ASSISTANT_AI_OBS_LOG_FORMAT ?? "json");
        if (format === "text") {
          const latencyS = (evt.latencyMs / 1000).toFixed(2);
          const cost = evt.costUsd ? evt.costUsd.toFixed(4) : "0.0000";
          console.log(
            `Agent: ${evt.agent} Tokens: ${evt.tokens.total} Latency: ${latencyS}s Tool Calls: ${evt.toolCalls} Cost: $${cost}`
          );
        } else {
          console.log(
            JSON.stringify({
              type: "ai.observability",
              agent: evt.agent,
              sessionId: evt.sessionId,
              traceId: evt.traceId ?? null,
              tokens: evt.tokens,
              toolCalls: evt.toolCalls,
              latencyMs: evt.latencyMs,
              costUsd: evt.costUsd,
              ok: evt.ok,
            })
          );
        }
      }
      this.deps.bus?.emit("ai.observability", evt);
      span.end();
      return out;
    } catch (err) {
      const evt: AgentObsEvent = {
        agent,
        sessionId: ctx.sessionId,
        traceId,
        ts: Date.now(),
        latencyMs: timer.elapsedMs(),
        toolCalls: store.toolCalls,
        model: store.model,
        llmCalls: store.llmCalls,
        tokens: {
          prompt: store.promptTokens,
          completion: store.completionTokens,
          total: store.promptTokens + store.completionTokens,
        },
        costUsd: store.costUsd,
        ok: false,
      };
      this.deps.metrics.histogram("ai_agent_latency_ms").observe(evt.latencyMs);
      this.pushEvent(evt);
      this.deps.bus?.emit("ai.observability", evt);
      span.end();
      throw err;
    }
  }
}

export function wrapLlmProvider(params: {
  base: LLMProvider;
  model?: string;
  tracker: AgentTracker;
}): LLMProvider {
  return {
    name: params.base.name,
    chat: async (input) => {
      const startedAt = Date.now();
      const out = await params.base.chat(input);
      params.tracker.recordLlmUsage({
        model: params.model,
        messages: input.messages,
        outputText: out,
      });
      params.tracker.recordLlmLatency(Date.now() - startedAt);
      return out;
    },
  };
}
