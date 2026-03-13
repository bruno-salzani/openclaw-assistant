import type { LLMMessage, LLMProvider } from "./llm-provider.js";
import type { EventBus } from "../infra/event-bus.js";

export type LLMRoute = "cheap" | "reasoning" | "coding" | "offline" | "default";

function contentLen(messages: LLMMessage[]) {
  let n = 0;
  for (const m of messages) n += (m.content ?? "").length;
  return n;
}

function normalizeRole(role: string) {
  const r = String(role || "").toLowerCase();
  if (r === "system") return "system";
  if (r === "assistant") return "assistant";
  return "user";
}

function normalizeForChat(messages: LLMMessage[]) {
  return messages
    .map((m) => ({ role: normalizeRole(m.role), content: String(m.content ?? "") }))
    .filter((m) => Boolean(m.content.trim()));
}

function sliceToCharsFromEnd(messages: LLMMessage[], maxChars: number) {
  const out: LLMMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    const len = (m.content ?? "").length;
    if (out.length > 0 && used + len > maxChars) break;
    out.push(m);
    used += len;
  }
  return out.reverse();
}

function messageScore(m: LLMMessage) {
  const role = normalizeRole(m.role);
  const text = String(m.content ?? "");
  const lower = text.toLowerCase();
  let score = 0;
  if (role === "system") score += 2;
  if (/```[\s\S]*?```/.test(text)) score += 15;
  if (/\b(error|exception|stack trace|traceback)\b/i.test(text)) score += 10;
  if (
    /\b(decision|decis[aã]o|acordado|agreed|vamos|next step|próximo passo|plano|plan)\b/i.test(text)
  )
    score += 8;
  if (/\b(tool|tools|resultado|result|output|saída|taskid|workflow)\b/i.test(text)) score += 6;
  if (/\d/.test(text)) score += 3;
  if (/https?:\/\/|localhost|127\.0\.0\.1/i.test(text)) score += 2;
  if (lower.includes("fix") || lower.includes("bug") || lower.includes("refactor")) score += 3;
  const trimmedLen = text.trim().length;
  if (trimmedLen > 0) score += Math.min(3, Math.floor(trimmedLen / 500));
  return score;
}

function selectRelevantHistory(head: LLMMessage[], remainingChars: number) {
  if (remainingChars <= 0) return [];
  const withIdx = head.map((m, idx) => ({ idx, m, score: messageScore(m) }));
  withIdx.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : b.idx - a.idx));
  const selected: Array<{ idx: number; m: LLMMessage }> = [];
  let used = 0;
  for (const it of withIdx) {
    const len = (it.m.content ?? "").length;
    if (len <= 0) continue;
    if (used + len > remainingChars) continue;
    selected.push({ idx: it.idx, m: it.m });
    used += len;
    if (used >= remainingChars) break;
  }
  selected.sort((a, b) => a.idx - b.idx);
  return selected.map((x) => x.m);
}

export class LLMRouter implements LLMProvider {
  name = "router";

  private readonly providers: Partial<Record<LLMRoute, LLMProvider>>;

  private readonly fallback?: LLMProvider;

  private readonly bus?: EventBus;

  constructor(params: {
    cheap?: LLMProvider;
    reasoning?: LLMProvider;
    coding?: LLMProvider;
    offline?: LLMProvider;
    default?: LLMProvider;
    fallback?: LLMProvider;
    bus?: EventBus;
  }) {
    this.providers = {
      cheap: params.cheap,
      reasoning: params.reasoning,
      coding: params.coding,
      offline: params.offline,
      default: params.default,
    };
    this.fallback = params.fallback;
    this.bus = params.bus;
  }

  pickRoute(messages: LLMMessage[]): LLMRoute {
    if (String(process.env.IA_ASSISTANT_LLM_OFFLINE ?? "0") === "1") return "offline";
    const normalized = normalizeForChat(messages);
    const total = contentLen(normalized);
    const lastNonSystem = [...normalized].reverse().find((m) => m.role !== "system")?.content ?? "";
    const window = normalized.slice(Math.max(0, normalized.length - 6));
    const corpus = window.map((m) => m.content).join("\n\n");
    const lower = corpus.toLowerCase();

    const codingSignals = [
      "typescript",
      "javascript",
      "node",
      "react",
      "next.js",
      "eslint",
      "prettier",
      "tsc",
      "compile",
      "stack trace",
      "error:",
      "refactor",
      "bug",
      "fix",
      "implement",
      "unit test",
      "linter",
      "pr",
      "patch",
      "diff",
      "repository",
      "code",
    ];
    const reasoningSignals = [
      "analyze",
      "analysis",
      "trade-off",
      "tradeoff",
      "architecture",
      "design",
      "prove",
      "reason",
      "strategy",
      "plan",
      "decision",
      "compare",
      "evaluate",
      "threat model",
      "risk",
    ];

    const hasCodeBlock = /```[\s\S]*?```/.test(corpus);
    if (hasCodeBlock) return "coding";
    if (codingSignals.some((s) => lower.includes(s))) return "coding";

    const reasoningMinChars = Number(process.env.IA_ASSISTANT_LLM_REASONING_MIN_CHARS ?? 8000);
    const lastMin = Number(process.env.IA_ASSISTANT_LLM_LONGPROMPT_LAST_MIN_CHARS ?? 800);
    const longPrompt =
      (Number.isFinite(lastMin) ? lastNonSystem.length >= lastMin : lastNonSystem.length >= 800) ||
      (Number.isFinite(reasoningMinChars) && total >= reasoningMinChars);
    if (longPrompt) return "reasoning";
    if (reasoningSignals.some((s) => lower.includes(s))) return "reasoning";

    return "cheap";
  }

  listConfiguredProviders() {
    const out: Record<string, string> = {};
    for (const k of Object.keys(this.providers)) {
      const p = (this.providers as any)[k] as LLMProvider | undefined;
      if (p) out[k] = p.name;
    }
    if (this.fallback) out.fallback = this.fallback.name;
    return out;
  }

  async chatWithRoute(
    route: LLMRoute,
    input: { messages: LLMMessage[]; temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const preparedMessages = await this.prepareMessages(input.messages);
    const normalized = normalizeForChat(preparedMessages);
    const totalChars = contentLen(normalized);
    const lastNonSystemChars =
      ([...normalized].reverse().find((m) => m.role !== "system")?.content ?? "").length;
    const providers = this.orderedProviders(route);
    if (providers.length === 0) {
      throw new Error("No LLM providers configured");
    }
    try {
      this.bus?.emit("llm.routed", {
        route,
        totalChars,
        lastNonSystemChars,
        ts: Date.now(),
        forced: true,
      });
    } catch {}
    let lastErr: unknown;
    for (const p of providers) {
      try {
        const out = await p.chat({ ...input, messages: preparedMessages });
        try {
          this.bus?.emit("llm.routed", {
            route,
            provider: p.name,
            totalChars,
            lastNonSystemChars,
            ts: Date.now(),
            forced: true,
          });
        } catch {}
        return out;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private orderedProviders(route: LLMRoute): LLMProvider[] {
    const routeProvider = this.providers[route];
    const defaultProvider = this.providers.default;
    const offlineProvider = this.providers.offline;
    const out = [routeProvider, defaultProvider, offlineProvider, this.fallback].filter(
      (x): x is LLMProvider => Boolean(x)
    );
    const seen = new Set<string>();
    return out.filter((p) => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
  }

  private async prepareMessages(messages: LLMMessage[]): Promise<LLMMessage[]> {
    const normalized = normalizeForChat(messages);
    const maxChars = Number(process.env.IA_ASSISTANT_LLM_MAX_CONTEXT_CHARS ?? 24_000);
    const systemMax = Number(process.env.IA_ASSISTANT_LLM_SYSTEM_CONTEXT_MAX_CHARS ?? 12_000);
    if (!Number.isFinite(maxChars) || maxChars <= 0) return normalized;
    if (contentLen(normalized) <= maxChars) return normalized;

    const summarize = String(process.env.IA_ASSISTANT_LLM_SUMMARIZE ?? "0") === "1";
    const keepLast = Number(process.env.IA_ASSISTANT_LLM_SUMMARY_KEEP_LAST ?? 8);
    const systemMessages = normalized.filter((m) => m.role === "system");
    const systemText = systemMessages
      .map((m) => m.content)
      .join("\n\n")
      .slice(0, systemMax);
    const nonSystem = normalized.filter((m) => m.role !== "system");

    const base: LLMMessage[] = systemText.trim() ? [{ role: "system", content: systemText }] : [];
    const tail =
      keepLast > 0 ? nonSystem.slice(Math.max(0, nonSystem.length - keepLast)) : nonSystem;
    const head = keepLast > 0 ? nonSystem.slice(0, Math.max(0, nonSystem.length - keepLast)) : [];

    if (summarize && head.length > 0) {
      const summarizer = this.providers.cheap;
      if (summarizer && summarizer.name !== this.name) {
        try {
          const summary = await summarizer.chat({
            messages: [
              {
                role: "system",
                content:
                  "Resuma a conversa em bullets curtos e preservando fatos e decisões. Não invente. Responda em português do Brasil.",
              },
              ...head.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
            ],
            temperature: 0.2,
            maxTokens: 500,
          });
          const summaryText = String(summary || "").trim();
          const summarized = summaryText
            ? [{ role: "system", content: `[Conversation Summary]\n${summaryText}` }]
            : [];
          const combined = [...base, ...summarized, ...tail];
          return sliceToCharsFromEnd(combined, maxChars);
        } catch {}
      }
      const baseLen = contentLen(base);
      const tailLen = contentLen(tail);
      const remaining = maxChars - baseLen - tailLen;
      const selectedHead = selectRelevantHistory(head, remaining);
      const combined = [...base, ...selectedHead, ...tail];
      return sliceToCharsFromEnd(combined, maxChars);
    }

    return sliceToCharsFromEnd([...base, ...tail], maxChars);
  }

  async chat(input: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const preparedMessages = await this.prepareMessages(input.messages);
    const normalized = normalizeForChat(preparedMessages);
    const totalChars = contentLen(normalized);
    const lastNonSystemChars =
      ([...normalized].reverse().find((m) => m.role !== "system")?.content ?? "").length;
    const route = this.pickRoute(preparedMessages);
    const providers = this.orderedProviders(route);
    if (providers.length === 0) {
      throw new Error("No LLM providers configured");
    }
    try {
      this.bus?.emit("llm.routed", {
        route,
        totalChars,
        lastNonSystemChars,
        ts: Date.now(),
      });
    } catch {}
    let lastErr: unknown;
    for (const p of providers) {
      try {
        const out = await p.chat({ ...input, messages: preparedMessages });
        try {
          this.bus?.emit("llm.routed", {
            route,
            provider: p.name,
            totalChars,
            lastNonSystemChars,
            ts: Date.now(),
          });
        } catch {}
        return out;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
