import type { LLMProvider } from "../llm/llm-provider.js";
import { runDebate } from "../reasoning/debate-engine.js";
import { ReasoningMemory } from "../reasoning/reasoning-memory.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { ReputationSystem } from "./reputation-system.js";
import { reachSwarmConsensus, type SwarmProposal } from "./consensus-engine.js";

export class SwarmCoordinator {
  constructor(
    private readonly deps: {
      llm?: LLMProvider;
      memory: MemorySystem;
      reputation: ReputationSystem;
    }
  ) {}

  async debate(params: { task: string; proposals: SwarmProposal[]; reputationWeight?: number }) {
    const proposals = params.proposals;
    const debate = await runDebate({
      task: params.task,
      llm: this.deps.llm,
      proposals: proposals.map((p) => ({ id: p.id, text: p.text })),
      memory: new ReasoningMemory(this.deps.memory),
    });
    const consensus = reachSwarmConsensus({
      proposals,
      baseScores: debate.ranking.map((r) => ({ proposalId: r.proposalId, score: r.score })),
      reputation: (agent) => this.deps.reputation.get(agent),
      reputationWeight: params.reputationWeight,
    });
    return { ok: true, debate, consensus };
  }
}

