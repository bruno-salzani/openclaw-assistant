import type { LLMProvider } from "../../llm/llm-provider.js";
import { tryParseJson } from "../../infra/json.js";

export type SelfCriticResult = {
  score: number;
  critique: string;
  improved: string;
  raw?: string;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class SelfCritic {
  constructor(private readonly deps: { llm?: LLMProvider }) {}

  async evaluate(params: { prompt: string; answer: string }): Promise<SelfCriticResult> {
    const llm = this.deps.llm;
    if (!llm) return { score: 1, critique: "", improved: String(params.answer ?? "") };

    const request = [
      "Avalie criticamente a resposta e proponha uma versão melhor.",
      "Critérios:",
      "- factual accuracy",
      "- completeness",
      "- reasoning quality",
      "Retorne APENAS JSON:",
      `{"score":0.0,"critique":"...","improved":"..."}`,
      "",
      `Prompt: ${params.prompt}`,
      "",
      `Answer: ${params.answer}`,
    ].join("\n");

    const out = await llm.chat({
      messages: [
        { role: "system", content: "You are a strict self-critic. Output JSON only." },
        { role: "user", content: request },
      ],
      temperature: 0.2,
      maxTokens: 900,
    });

    const parsed = tryParseJson<Record<string, unknown>>(out);
    const score = clamp01(Number(parsed?.score ?? 0));
    const critique = typeof parsed?.critique === "string" ? parsed.critique : "";
    const improved = typeof parsed?.improved === "string" && parsed.improved.trim() ? parsed.improved : params.answer;
    return { score, critique, improved, raw: out };
  }
}
