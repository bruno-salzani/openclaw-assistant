import type { LLMProvider } from "../llm/llm-provider.js";
import type { CognitivePerception, CognitiveReasoning } from "./types.js";
import type { KnowledgeState } from "../world-model/knowledge-state.js";
import type { PredictionEngine } from "../world-model/prediction-engine.js";

function spawnFromPerception(p: CognitivePerception) {
  const obj = p.objective.toLowerCase();
  const wantsMarket =
    p.domainHints.includes("market") || obj.includes("startup") || obj.includes("market");
  const wantsFinance =
    p.domainHints.includes("finance") || obj.includes("revenue") || obj.includes("pricing");
  const wantsTrend = p.domainHints.includes("trend") || obj.includes("trend") || obj.includes("growth");
  const wantsEngineering =
    p.domainHints.includes("engineering") || p.signals.hasCode || obj.includes("refactor") || obj.includes("bug");

  const spawn: CognitiveReasoning["spawn"] = [];
  const add = (id: string, role: any, prompt: string) => {
    spawn.push({ id, role, prompt });
  };

  const wantSwarm =
    p.complexity === "high" ||
    p.domainHints.length >= 3 ||
    (p.domainHints.length >= 2 && (p.signals.wantsAnalysis || p.signals.wantsExecution));
  if (wantSwarm) {
    if (wantsMarket) add("market_research", "research", `Pesquise mercado e concorrentes para: ${p.objective}`);
    if (wantsTrend) add("trend_analysis", "analyst", `Analise tendências e sinais para: ${p.objective}`);
    if (wantsFinance) add("financial_analysis", "finance", `Analise impactos financeiros para: ${p.objective}`);
    if (wantsEngineering) add("engineering_risks", "reliability", `Liste riscos técnicos e mitigação para: ${p.objective}`);
  }

  return spawn.slice(0, 6);
}

function planStrategy(p: CognitivePerception) {
  if (p.signals.hasCode) return "planning" as const;
  if (p.signals.wantsExecution) return "planning" as const;
  if (p.complexity === "high") return "planning" as const;
  return "direct" as const;
}

export class ReasoningEngine {
  constructor(
    private readonly deps: {
      llm?: LLMProvider;
      world?: { state: KnowledgeState; predictor: PredictionEngine };
    }
  ) {}

  async reason(perception: CognitivePerception): Promise<CognitiveReasoning> {
    const assumptions: string[] = [];
    const constraints: string[] = [];
    const risks: string[] = [];

    if (perception.modality !== "text") constraints.push("modality_non_text");
    if (!perception.objective.trim()) risks.push("missing_objective");
    if (perception.signals.hasCode) assumptions.push("code_context_present");

    const spawn = spawnFromPerception(perception);
    const strategy = planStrategy(perception);
    if (strategy === "planning") assumptions.push("multi_step_execution");

    if (this.deps.world) {
      try {
        const pred = await this.deps.world.predictor.predict({
          objective: perception.objective,
          knowledge: this.deps.world.state.snapshot(),
        });
        if (pred.risks.length > 0) risks.push(...pred.risks.slice(0, 5));
        if (pred.assumptions.length > 0) assumptions.push(...pred.assumptions.slice(0, 5));
      } catch {}
    }

    if (this.deps.llm && String(process.env.IA_ASSISTANT_COGNITION_REASONING_LLM ?? "0") === "1") {
      try {
        const out = await this.deps.llm.chat({
          messages: [
            { role: "system", content: "Extract risks/constraints/assumptions. Output JSON only." },
            {
              role: "user",
              content: JSON.stringify({ objective: perception.objective, hints: perception.domainHints }),
            },
          ],
          temperature: 0.2,
          maxTokens: 400,
        });
        const parsed = JSON.parse(out) as any;
        if (Array.isArray(parsed?.assumptions)) assumptions.push(...parsed.assumptions.map(String));
        if (Array.isArray(parsed?.constraints)) constraints.push(...parsed.constraints.map(String));
        if (Array.isArray(parsed?.risks)) risks.push(...parsed.risks.map(String));
      } catch {}
    }

    return {
      assumptions: Array.from(new Set(assumptions)).slice(0, 12),
      constraints: Array.from(new Set(constraints)).slice(0, 12),
      risks: Array.from(new Set(risks)).slice(0, 12),
      spawn,
    };
  }
}
