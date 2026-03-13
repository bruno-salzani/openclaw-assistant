import type { LLMProvider } from "../llm/llm-provider.js";
import type { ResearchExperiment } from "./experiment-designer.js";

export type ResearchFinding = {
  hypothesisId: string;
  experimentId: string;
  summary: string;
  evidence?: unknown;
};

export async function analyzeResults(params: {
  llm?: LLMProvider;
  topic: string;
  experiments: ResearchExperiment[];
  results: Array<{ experimentId: string; output: any }>;
}): Promise<ResearchFinding[]> {
  const byId = new Map(params.results.map((r) => [r.experimentId, r.output]));
  const findings: ResearchFinding[] = [];
  for (const e of params.experiments) {
    const out = byId.get(e.id);
    const raw = JSON.stringify(out).slice(0, 4000);
    if (!params.llm || process.env.IA_ASSISTANT_AUTONOMOUS_RESEARCH_LLM !== "1") {
      findings.push({
        hypothesisId: e.hypothesisId,
        experimentId: e.id,
        summary: `${e.kind} ok; topic=${params.topic}; bytes=${raw.length}`,
        evidence: out,
      });
      continue;
    }
    try {
      const prompt = [
        "Resuma o resultado e extraia 1 insight acionável. Seja honesto sobre limitações.",
        "",
        `Topic: ${params.topic}`,
        `Experiment: ${JSON.stringify(e)}`,
        `Output: ${raw}`,
      ].join("\n");
      const text = await params.llm.chat({
        messages: [
          { role: "system", content: "You are a research analyst. Be factual." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        maxTokens: 600,
      });
      findings.push({
        hypothesisId: e.hypothesisId,
        experimentId: e.id,
        summary: String(text ?? "").slice(0, 1200),
        evidence: out,
      });
    } catch {
      findings.push({
        hypothesisId: e.hypothesisId,
        experimentId: e.id,
        summary: `${e.kind} ok`,
        evidence: out,
      });
    }
  }
  return findings.slice(0, 50);
}

