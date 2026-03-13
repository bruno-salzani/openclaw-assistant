import type { LLMProvider } from "../llm/llm-provider.js";
import { proposeWithPlanner, critiqueWithCritic, type Proposal } from "./argument-engine.js";
import { voteOnProposals } from "./voting-system.js";
import { reachConsensus } from "./consensus-engine.js";
import { ReasoningMemory } from "./reasoning-memory.js";

export type DebateResult = {
  winner: Proposal;
  proposals: Proposal[];
  critiques: Array<{ proposalId: string; text: string }>;
  ranking: Array<{ proposalId: string; score: number; breakdown: Record<string, number> }>;
};

export async function runDebate(params: {
  task: string;
  llm?: LLMProvider;
  variants?: number;
  proposals?: Proposal[];
  memory?: ReasoningMemory;
}) {
  const proposals =
    Array.isArray(params.proposals) && params.proposals.length > 0
      ? params.proposals
      : await proposeWithPlanner({
          task: params.task,
          llm: params.llm,
          variants: params.variants ?? 2,
        });
  const critiques = await critiqueWithCritic({ task: params.task, proposals, llm: params.llm });
  const scores = voteOnProposals({ proposals, critiques });
  const consensus = reachConsensus({ proposals, scores });

  const result: DebateResult = {
    winner: consensus.winner,
    proposals,
    critiques,
    ranking: scores,
  };

  await params.memory?.recordDebate({
    task: params.task,
    proposals: proposals.map((p) => ({ id: p.id, text: p.text })),
    critiques: critiques.map((c) => ({ proposalId: c.proposalId, text: c.text })),
    winnerId: result.winner.id,
    ts: Date.now(),
    meta: { scores },
  });

  return result;
}
