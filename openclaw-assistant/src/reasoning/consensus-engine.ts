import type { Proposal } from "./argument-engine.js";
import type { VoteScore } from "./voting-system.js";

export type ConsensusResult = {
  winner: Proposal;
  ranking: VoteScore[];
};

export function reachConsensus(params: { proposals: Proposal[]; scores: VoteScore[] }): ConsensusResult {
  const byId = new Map(params.proposals.map((p) => [p.id, p]));
  const top = params.scores[0];
  if (!top) {
    const winner = params.proposals[0];
    if (!winner) throw new Error("no proposals");
    return { winner, ranking: [] };
  }
  const winner = byId.get(top.proposalId) ?? params.proposals[0];
  if (!winner) throw new Error("no proposals");
  return { winner, ranking: params.scores };
}

