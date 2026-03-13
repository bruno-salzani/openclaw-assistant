import type { PredictionEngine } from "./prediction-engine.js";
import type { KnowledgeState } from "./knowledge-state.js";

export class PlanningSimulator {
  constructor(private readonly deps: { state: KnowledgeState; predictor: PredictionEngine }) {}

  async simulate(params: { objective: string; actions: string[] }) {
    const objective = String(params.objective ?? "").trim();
    const actions = Array.isArray(params.actions) ? params.actions.map(String).filter(Boolean) : [];
    const knowledge = this.deps.state.snapshot();
    const scored = await Promise.all(
      actions.map(async (a) => {
        const pred = await this.deps.predictor.predict({ objective: `${objective}\nAction: ${a}`, knowledge });
        const riskScore = pred.risks.length;
        return { action: a, prediction: pred, riskScore };
      })
    );
    return scored.sort((a, b) => a.riskScore - b.riskScore);
  }
}

