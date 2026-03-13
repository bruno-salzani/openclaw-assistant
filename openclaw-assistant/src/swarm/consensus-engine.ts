export type SwarmProposal = { id: string; agent: string; text: string };

export type SwarmConsensus = {
  winner: SwarmProposal;
  ranking: Array<{ proposalId: string; score: number }>;
};

export function reachSwarmConsensus(params: {
  proposals: SwarmProposal[];
  baseScores: Array<{ proposalId: string; score: number }>;
  reputation: (agent: string) => number;
  reputationWeight?: number;
}): SwarmConsensus {
  const proposals = params.proposals;
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const repW = typeof params.reputationWeight === "number" ? params.reputationWeight : 0.25;

  const adjusted = params.baseScores
    .map((s) => {
      const p = byId.get(s.proposalId);
      const rep = p ? params.reputation(p.agent) : 0.5;
      const score = Number(s.score ?? 0) + repW * Number(rep ?? 0.5);
      return { proposalId: s.proposalId, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = adjusted[0]?.proposalId ?? proposals[0]?.id;
  const winner = (top ? byId.get(top) : null) ?? proposals[0];
  if (!winner) throw new Error("no proposals");
  return { winner, ranking: adjusted };
}

