import type { MemorySystem } from "../memory/memory-system.js";
import type { KnowledgeState } from "../world-model/knowledge-state.js";
import type { CognitiveLearningRecord } from "./types.js";

export class LearningEngine {
  constructor(private readonly deps: { memory: MemorySystem; world?: KnowledgeState }) {}

  async record(rec: CognitiveLearningRecord) {
    await this.deps.memory.add("meta", JSON.stringify(rec), {
      type: "cognition_trace",
      ts: rec.ts,
      sessionId: rec.sessionId,
      userId: rec.userId,
    });
    if (this.deps.world) {
      try {
        await this.deps.world.ingest({
          type: "interaction",
          ts: rec.ts,
          sessionId: rec.sessionId,
          userId: rec.userId,
          objective: rec.objective,
          outcomeOk: true,
        });
      } catch {}
    }
  }
}

