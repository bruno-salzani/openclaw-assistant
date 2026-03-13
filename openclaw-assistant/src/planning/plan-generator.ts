import type { GoalDecomposition } from "./goal-decomposer.js";

export type PlanningStep = {
  id: string;
  type: "research" | "execute" | "analyze";
  dependsOn?: string[];
  payload?: Record<string, unknown>;
  priority?: "low" | "medium" | "high";
};

export type GeneratedPlan = {
  objective: string;
  steps: PlanningStep[];
};

function normId(v: string) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generatePlan(decomp: GoalDecomposition): GeneratedPlan {
  const objective = String(decomp.goal ?? "");
  const steps: PlanningStep[] = [];
  let prev: string | null = null;
  for (const sg of decomp.subgoals) {
    const id = normId(sg) || `step-${steps.length + 1}`;
    const type =
      sg.includes("analyze") || sg.includes("summarize") ? "analyze" : sg.includes("implement") ? "execute" : "research";
    const step: PlanningStep = {
      id,
      type,
      dependsOn: prev ? [prev] : [],
      payload: { query: sg, objective },
      priority: type === "execute" ? "high" : "medium",
    };
    steps.push(step);
    prev = id;
  }
  return { objective, steps: steps.slice(0, 12) };
}

