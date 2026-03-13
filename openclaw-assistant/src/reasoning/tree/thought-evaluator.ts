import type { LLMProvider } from "../../llm/llm-provider.js";
import type { Thought } from "./thought-generator.js";

export type ThoughtScore = { id: string; score: number };

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export async function evaluateThoughts(params: {
  llm?: LLMProvider;
  question: string;
  thoughts: Thought[];
}): Promise<ThoughtScore[]> {
  const q = String(params.question ?? "").trim();
  const thoughts = params.thoughts.slice(0, 10);
  if (!q || thoughts.length === 0) return [];

  if (!params.llm || process.env.IA_ASSISTANT_COGNITIVE_TREE_LLM !== "1") {
    return thoughts.map((t) => ({ id: t.id, score: clamp01(0.5 + Math.min(0.4, t.text.length / 2000)) }));
  }

  const prompt = [
    "Avalie cada thought (0–1) por plausibilidade, cobertura e segurança.",
    'Retorne APENAS JSON: {"scores":[{"id":"t1","score":0.8},{"id":"t2","score":0.4}]}',
    "",
    `Pergunta: ${q}`,
    JSON.stringify(thoughts),
  ].join("\n");

  try {
    const out = await params.llm.chat({
      messages: [
        { role: "system", content: "You are a strict evaluator. Output JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 400,
    });
    const parsed = JSON.parse(out);
    const rawScores = Array.isArray((parsed as any)?.scores) ? ((parsed as any).scores as any[]) : [];
    const byId = new Map<string, any>();
    for (const s of rawScores) byId.set(String((s as any)?.id ?? ""), s);
    return thoughts.map((t) => {
      const v = byId.get(t.id);
      const s = clamp01(Number(v?.score));
      return { id: t.id, score: Number.isFinite(s) ? s : 0.5 };
    });
  } catch {
    return thoughts.map((t) => ({ id: t.id, score: 0.5 }));
  }
}
