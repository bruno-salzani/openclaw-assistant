import type { MemorySystem } from "../memory/memory-system.js";

export type DebateRecord = {
  task: string;
  proposals: Array<{ id: string; text: string }>;
  critiques: Array<{ proposalId: string; text: string }>;
  winnerId: string;
  ts: number;
  meta?: Record<string, unknown>;
};

export class ReasoningMemory {
  constructor(private readonly memory?: MemorySystem) {}

  async recordDebate(record: DebateRecord) {
    if (!this.memory) return;
    await this.memory.add("event", "reasoning_debate", record as any);
  }
}

