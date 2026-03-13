import type { Hypothesis } from "./hypothesis-generator.js";

export type ResearchExperiment =
  | { kind: "web_search"; id: string; query: string; hypothesisId: string }
  | { kind: "ab_test"; id: string; prompts: Array<{ id: string; text: string }>; hypothesisId: string };

function normId(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function designExperiments(params: { hypotheses: Hypothesis[]; max?: number }): ResearchExperiment[] {
  const hs = params.hypotheses.slice(0, 10);
  const max = Math.max(1, Math.min(20, Number(params.max ?? 8)));
  const exps: ResearchExperiment[] = [];
  for (const h of hs) {
    exps.push({ kind: "web_search", id: `ws:${normId(h.id)}`, query: h.text, hypothesisId: h.id });
    exps.push({
      kind: "ab_test",
      id: `ab:${normId(h.id)}`,
      hypothesisId: h.id,
      prompts: [
        { id: "short", text: `Responda de forma concisa: ${h.text}` },
        { id: "long", text: `Responda com mais detalhes, incluindo riscos e fontes: ${h.text}` },
      ],
    });
  }
  return exps.slice(0, max);
}

