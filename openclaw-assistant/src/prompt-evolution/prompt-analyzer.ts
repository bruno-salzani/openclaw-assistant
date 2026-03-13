import { buildPromptImprovementCandidates } from "../optimization/prompt-optimizer.js";

export type PromptIssue = { hint: string; count: number };

export function analyzePromptDataset(params: { datasetPath: string; limit?: number }) {
  const res = buildPromptImprovementCandidates({ datasetPath: params.datasetPath, limit: params.limit });
  const issues: Record<string, number> = {};
  for (const s of res.suggestions) {
    const c = String(s.correction ?? "").toLowerCase();
    if (!c) continue;
    if (c.includes("fonte") || c.includes("source")) issues.add_sources = (issues.add_sources ?? 0) + 1;
    if (c.includes("mais conciso") || c.includes("concise")) issues.be_concise = (issues.be_concise ?? 0) + 1;
    if (c.includes("passos") || c.includes("steps")) issues.add_steps = (issues.add_steps ?? 0) + 1;
    if (c.includes("segurança") || c.includes("safety")) issues.safety = (issues.safety ?? 0) + 1;
  }
  const ranked: PromptIssue[] = Object.entries(issues)
    .map(([hint, count]) => ({ hint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { ok: true, dataset: { totalRows: res.totalRows, userCorrections: res.userCorrections }, issues: ranked };
}

