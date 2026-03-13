import type { LLMProvider } from "../llm/llm-provider.js";
import type { KnowledgeSnapshot } from "./knowledge-state.js";

export type PredictionRequest = {
  objective: string;
  knowledge: KnowledgeSnapshot;
};

export type Prediction = {
  assumptions: string[];
  risks: string[];
  expectedOutcome: string;
};

export class PredictionEngine {
  constructor(private readonly deps: { llm?: LLMProvider }) {}

  async predict(req: PredictionRequest): Promise<Prediction> {
    const objective = String(req.objective ?? "").trim();
    const assumptions: string[] = [];
    const risks: string[] = [];
    if (!objective) return { assumptions: [], risks: ["missing_objective"], expectedOutcome: "" };

    const lower = objective.toLowerCase();
    if (lower.includes("deploy") || lower.includes("produção") || lower.includes("production")) {
      risks.push("deployment_risk");
      assumptions.push("ci_green_required");
    }
    if (lower.includes("refactor") || lower.includes("migra")) {
      risks.push("regression_risk");
      assumptions.push("tests_required");
    }
    if (lower.includes("market") || lower.includes("startup")) {
      assumptions.push("market_data_required");
      risks.push("data_staleness");
    }

    const enabled = Boolean(this.deps.llm) && String(process.env.IA_ASSISTANT_WORLD_MODEL_PREDICT_LLM ?? "0") === "1";
    if (!enabled || !this.deps.llm) {
      return {
        assumptions: Array.from(new Set(assumptions)).slice(0, 10),
        risks: Array.from(new Set(risks)).slice(0, 10),
        expectedOutcome: "unknown",
      };
    }

    try {
      const out = await this.deps.llm.chat({
        messages: [
          { role: "system", content: "You predict likely outcomes. Output JSON only." },
          { role: "user", content: JSON.stringify({ objective, knowledge: req.knowledge }) },
        ],
        temperature: 0.2,
        maxTokens: 600,
      });
      const parsed = JSON.parse(out) as any;
      const a = Array.isArray(parsed?.assumptions)
        ? (parsed.assumptions as any[]).map((x) => String(x))
        : assumptions;
      const r = Array.isArray(parsed?.risks) ? (parsed.risks as any[]).map((x) => String(x)) : risks;
      const expected = typeof parsed?.expectedOutcome === "string" ? parsed.expectedOutcome : "unknown";
      return {
        assumptions: Array.from(new Set(a)).slice(0, 10),
        risks: Array.from(new Set(r)).slice(0, 10),
        expectedOutcome: String(expected).slice(0, 400),
      };
    } catch {
      return {
        assumptions: Array.from(new Set(assumptions)).slice(0, 10),
        risks: Array.from(new Set(risks)).slice(0, 10),
        expectedOutcome: "unknown",
      };
    }
  }
}
