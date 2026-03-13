import type { LLMProvider } from "../llm/llm-provider.js";
import type { KnowledgeSnapshot } from "./knowledge-state.js";
import { tryParseJson } from "../infra/json.js";

export type OutcomePrediction = {
  successProbability: number;
  rationale: string;
  risks: string[];
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class OutcomePredictor {
  constructor(private readonly deps: { llm?: LLMProvider }) {}

  async predict(params: { planText: string; objective: string; knowledge: KnowledgeSnapshot }): Promise<OutcomePrediction> {
    const enabled = Boolean(this.deps.llm) && process.env.IA_ASSISTANT_WORLD_MODEL_PREDICT_LLM === "1";
    if (!enabled || !this.deps.llm) {
      const txt = `${params.objective}\n${params.planText}`.toLowerCase();
      let p = 0.6;
      if (txt.includes("deploy") || txt.includes("produção")) p -= 0.1;
      if (txt.includes("test") || txt.includes("lint") || txt.includes("typecheck")) p += 0.1;
      if (txt.includes("migration") || txt.includes("refactor")) p -= 0.05;
      return { successProbability: clamp01(p), rationale: "heuristic", risks: [] };
    }

    const req = [
      "Você é um predictor de outcomes.",
      "Dado um objetivo e um plano, estime probabilidade de sucesso 0-1 e riscos.",
      "Retorne APENAS JSON:",
      `{"successProbability":0.0,"rationale":"...","risks":["..."]}`,
      "",
      `Objective: ${params.objective}`,
      `Plan: ${params.planText}`,
      `Knowledge: ${JSON.stringify(params.knowledge)}`,
    ].join("\n");

    const out = await this.deps.llm.chat({
      messages: [
        { role: "system", content: "You predict outcomes. Output JSON only." },
        { role: "user", content: req },
      ],
      temperature: 0.2,
      maxTokens: 600,
    });
    const parsed = tryParseJson<Record<string, unknown>>(out) ?? {};
    const successProbability = clamp01(Number(parsed.successProbability ?? 0));
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
    const risks = Array.isArray(parsed.risks) ? parsed.risks.map((x: any) => String(x)) : [];
    return { successProbability, rationale, risks: risks.slice(0, 10) };
  }
}
