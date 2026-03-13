import type { LLMProvider } from "../../llm/llm-provider.js";
import { planWithTreeOfThought } from "../tree-of-thought.js";
import { evaluateThoughts } from "./thought-evaluator.js";
import { generateThoughts } from "./thought-generator.js";
import { selectBestPath } from "./path-selector.js";

export async function planWithCognitiveTree(params: {
  llm: LLMProvider;
  objective: string;
  contextText?: string;
  branches?: number;
  depth?: number;
}) {
  const thoughts = await generateThoughts({
    llm: params.llm,
    question: params.objective,
    branches: params.branches ?? 3,
  });
  const scores = await evaluateThoughts({ llm: params.llm, question: params.objective, thoughts });
  const bestThought = selectBestPath({ thoughts, scores });

  const out = await planWithTreeOfThought({
    llm: params.llm,
    objective: bestThought ? `${params.objective}\nBestThought: ${bestThought.text}` : params.objective,
    contextText: params.contextText,
    branches: params.branches,
    depth: params.depth,
  });

  return {
    plan: out.plan,
    trace: { thoughtScores: scores, thoughtSelected: bestThought?.id ?? null, tot: out.trace },
  };
}

