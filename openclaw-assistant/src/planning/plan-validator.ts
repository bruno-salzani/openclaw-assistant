import type { GeneratedPlan } from "./plan-generator.js";

export type PlanValidation = { ok: boolean; errors: string[] };

export function validatePlan(plan: GeneratedPlan): PlanValidation {
  const errors: string[] = [];
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["invalid_plan"] };
  if (!String(plan.objective ?? "").trim()) errors.push("missing_objective");
  const steps = Array.isArray((plan as any).steps) ? ((plan as any).steps as any[]) : [];
  if (steps.length === 0) errors.push("missing_steps");
  const ids = new Set<string>();
  for (const s of steps) {
    const id = String(s?.id ?? "").trim();
    if (!id) errors.push("step_missing_id");
    if (id && ids.has(id)) errors.push("duplicate_step_id");
    ids.add(id);
  }
  return { ok: errors.length === 0, errors };
}

