import type { LLMProvider } from "../llm/llm-provider.js";
import { tryParseJson } from "../infra/json.js";

export async function reflexionReviseAnswer(params: {
  llm: LLMProvider;
  prompt: string;
  answer: string;
}) {
  const request = [
    "Faça uma revisão crítica da resposta e gere uma versão melhor.",
    "Regras: preserve facts, não invente dados, mantenha segurança e política.",
    "Retorne APENAS JSON:",
    `{"critique":"...","revised":"..."}`,
    "",
    `Prompt: ${params.prompt}`,
    "",
    `Answer: ${params.answer}`,
  ].join("\n");

  const out = await params.llm.chat({
    messages: [
      { role: "system", content: "You are a careful reviewer. Output JSON only." },
      { role: "user", content: request },
    ],
    temperature: 0.3,
    maxTokens: 1200,
  });

  const parsed = tryParseJson<{ critique?: string; revised?: string }>(out);
  const revised = parsed?.revised ? String(parsed.revised) : String(params.answer);
  const critique = parsed?.critique ? String(parsed.critique) : "";
  return { revised, critique, raw: out };
}
