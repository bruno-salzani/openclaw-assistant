import type { Thought } from "./thought-generator.js";
import type { ThoughtScore } from "./thought-evaluator.js";

export function selectBestPath(params: { thoughts: Thought[]; scores: ThoughtScore[] }) {
  const byId = new Map(params.thoughts.map((t) => [t.id, t]));
  const ranked = params.scores
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ thought: byId.get(s.id), score: s.score }))
    .filter((x) => Boolean(x.thought));
  return ranked[0]?.thought ?? params.thoughts[0] ?? null;
}

