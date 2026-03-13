import { decomposeGoal } from "./goal-decomposer.js";
import { generatePlan, type PlanningStep } from "./plan-generator.js";
import { validatePlan } from "./plan-validator.js";

export type HtnPlan = {
  ok: boolean;
  objective: string;
  steps: PlanningStep[];
  reason?: string;
};

export function planHtn(params: { objective: string }): HtnPlan {
  const objective = String(params.objective ?? "").trim();
  if (!objective) return { ok: false, objective: "", steps: [], reason: "missing_objective" };

  try {
    const decomp = decomposeGoal(objective);
    const plan = generatePlan(decomp);
    const v = validatePlan(plan);
    if (!v.ok) return { ok: false, objective, steps: [], reason: (v.errors ?? []).join("; ") || "invalid_plan" };
    return { ok: true, objective, steps: plan.steps };
  } catch (err) {
    return { ok: false, objective, steps: [], reason: String(err) };
  }
}
