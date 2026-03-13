import type { LLMMessage } from "../llm/llm-provider.js";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function countWords(s: string) {
  const t = String(s || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function estimateTokensFromText(text: string) {
  const chars = String(text || "").length;
  const words = countWords(text);
  const byChars = Math.ceil(chars / 4);
  const byWords = Math.ceil(words / 0.75);
  return Math.max(1, Math.min(byChars, byWords));
}

export function estimateTokensFromMessages(messages: LLMMessage[]) {
  let total = 0;
  for (const m of messages) {
    total += estimateTokensFromText(String(m.content ?? ""));
    total += 4;
  }
  return total;
}

function normKey(model: string) {
  return String(model || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function estimateCostUsd(params: {
  model?: string;
  promptTokens: number;
  completionTokens: number;
}) {
  const modelKey = normKey(params.model ?? "");
  const per1k =
    (modelKey ? Number(process.env[`IA_ASSISTANT_LLM_COST_${modelKey}_PER_1K`] ?? NaN) : NaN) ||
    Number(process.env.IA_ASSISTANT_LLM_COST_DEFAULT_PER_1K ?? 0);
  if (!Number.isFinite(per1k) || per1k <= 0) return 0;
  const total = params.promptTokens + params.completionTokens;
  return (total / 1000) * per1k;
}
