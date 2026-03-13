import type { Proposal, Critique } from "./argument-engine.js";

export type VoteCriteriaWeights = {
  accuracy: number;
  latency: number;
  tokenCost: number;
  confidence: number;
};

export type VoteScore = {
  proposalId: string;
  score: number;
  breakdown: Record<string, number>;
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function defaultWeights(): VoteCriteriaWeights {
  return { accuracy: 0.5, latency: 0.2, tokenCost: 0.2, confidence: 0.1 };
}

function tokenize(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function hasAny(tokens: string[], words: string[]) {
  const set = new Set(tokens);
  return words.some((w) => set.has(w));
}

function scoreFromCritique(text: string) {
  const toks = tokenize(text);
  const redFlags = [
    hasAny(toks, ["unsafe", "security", "leak", "secret", "unauthorized", "danger"]),
    hasAny(toks, ["break", "regression", "bug", "error", "fail"]),
    hasAny(toks, ["no", "missing"]) && hasAny(toks, ["test", "tests", "lint", "typecheck"]),
  ].filter(Boolean).length;
  const positives = [
    hasAny(toks, ["test", "tests", "lint", "typecheck"]),
    hasAny(toks, ["safe", "secure", "permission", "policy"]),
    hasAny(toks, ["simple", "minimal", "scoped"]),
  ].filter(Boolean).length;
  const penalty = redFlags * 0.18;
  const bonus = positives * 0.08;
  return clamp01(0.6 - penalty + bonus);
}

export function voteOnProposals(params: {
  proposals: Proposal[];
  critiques: Critique[];
  weights?: Partial<VoteCriteriaWeights>;
}) {
  const weights: VoteCriteriaWeights = { ...defaultWeights(), ...(params.weights ?? {}) };
  const critiqueById = new Map<string, Critique[]>();
  for (const c of params.critiques) {
    const list = critiqueById.get(c.proposalId) ?? [];
    list.push(c);
    critiqueById.set(c.proposalId, list);
  }

  const scores: VoteScore[] = [];
  for (const p of params.proposals) {
    const critiques = critiqueById.get(p.id) ?? [];
    const critiqueScore = critiques.length
      ? critiques.reduce((a, c) => a + scoreFromCritique(c.text), 0) / critiques.length
      : 0.6;
    const length = String(p.text ?? "").length;
    const latencyScore = clamp01(1 - Math.min(1, length / 4000));
    const tokenCostScore = clamp01(1 - Math.min(1, length / 5000));
    const confidenceScore = critiqueScore;

    const breakdown = {
      accuracy: critiqueScore,
      latency: latencyScore,
      tokenCost: tokenCostScore,
      confidence: confidenceScore,
    };
    const score =
      breakdown.accuracy * weights.accuracy +
      breakdown.latency * weights.latency +
      breakdown.tokenCost * weights.tokenCost +
      breakdown.confidence * weights.confidence;

    scores.push({ proposalId: p.id, score, breakdown });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

