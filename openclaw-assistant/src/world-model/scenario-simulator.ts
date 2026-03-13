import type { KnowledgeState } from "./knowledge-state.js";
import type { OutcomePredictor, OutcomePrediction } from "./outcome-predictor.js";

export type Scenario = {
  id: string;
  objective: string;
  plans: Array<{ id: string; text: string }>;
};

export type SimulationResult = {
  scenarioId: string;
  outcomes: Array<{ planId: string; prediction: OutcomePrediction }>;
};

export class ScenarioSimulator {
  constructor(private readonly deps: { state: KnowledgeState; predictor: OutcomePredictor }) {}

  async simulate(s: Scenario): Promise<SimulationResult> {
    const knowledge = this.deps.state.snapshot();
    const outcomes = await Promise.all(
      s.plans.map(async (p) => ({
        planId: p.id,
        prediction: await this.deps.predictor.predict({
          planText: p.text,
          objective: s.objective,
          knowledge,
        }),
      }))
    );
    return { scenarioId: s.id, outcomes };
  }
}

