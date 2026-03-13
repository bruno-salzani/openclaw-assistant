import type { LLMProvider } from "../../llm/llm-provider.js";

export type Thought = { id: string; text: string };

export async function generateThoughts(params: {
  llm?: LLMProvider;
  question: string;
  branches: number;
}): Promise<Thought[]> {
  const branches = Math.max(2, Math.min(10, Math.floor(params.branches ?? 3)));
  const q = String(params.question ?? "").trim();
  if (!q) return [];
  if (!params.llm || process.env.IA_ASSISTANT_COGNITIVE_TREE_LLM !== "1") {
    const base = [
      "Buscar informações relevantes",
      "Gerar hipóteses/alternativas",
      "Avaliar trade-offs e riscos",
      "Consolidar resposta final",
    ];
    return base.slice(0, branches).map((t, i) => ({ id: `t${i + 1}`, text: `${t} (${q})` }));
  }
  const prompt = [
    "Gere múltiplos caminhos de raciocínio (thoughts) para responder à pergunta.",
    'Retorne APENAS JSON: {"thoughts":[{"id":"t1","text":"..."},{"id":"t2","text":"..."}]}',
    "",
    `Pergunta: ${q}`,
    `Quantidade: ${branches}`,
  ].join("\n");
  try {
    const out = await params.llm.chat({
      messages: [
        { role: "system", content: "You generate reasoning thoughts. Output JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 800,
    });
    const parsed = JSON.parse(out);
    const thoughts = Array.isArray(parsed?.thoughts) ? parsed.thoughts : [];
    return thoughts
      .map((t: any, i: number) => ({
        id: typeof t?.id === "string" ? t.id : `t${i + 1}`,
        text: typeof t?.text === "string" ? t.text : "",
      }))
      .filter((t: Thought) => t.text.trim())
      .slice(0, branches);
  } catch {
    return [];
  }
}

