export type GoalDecomposition = {
  goal: string;
  subgoals: string[];
};

export function decomposeGoal(goal: string): GoalDecomposition {
  const g = String(goal ?? "").trim();
  if (!g) return { goal: "", subgoals: [] };
  const lower = g.toLowerCase();
  const subgoals: string[] = [];

  if (lower.includes("market") || lower.includes("startup")) {
    subgoals.push("collect startups list", "analyze funding", "identify trends", "summarize insights");
  } else if (lower.includes("bug") || lower.includes("corrigir") || lower.includes("fix")) {
    subgoals.push("reproduce issue", "identify root cause", "implement fix", "run tests");
  } else {
    subgoals.push("gather requirements", "collect relevant information", "produce answer", "review for safety");
  }

  return { goal: g, subgoals: subgoals.slice(0, 8) };
}

