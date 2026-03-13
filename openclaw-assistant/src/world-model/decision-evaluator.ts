import type { SimulationResult } from "./scenario-simulator.js";

export type Decision = {
  bestPlanId: string;
  ranking: Array<{ planId: string; successProbability: number }>;
};

export function chooseBestPlan(sim: SimulationResult): Decision {
  const ranking = sim.outcomes
    .map((o) => ({
      planId: o.planId,
      successProbability: Number(o.prediction.successProbability ?? 0),
    }))
    .sort((a, b) => b.successProbability - a.successProbability);
  const bestPlanId = ranking[0]?.planId ?? "";
  return { bestPlanId, ranking };
}

