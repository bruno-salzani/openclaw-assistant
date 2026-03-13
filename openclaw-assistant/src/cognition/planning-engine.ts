import type { CognitivePerception, CognitivePlan, CognitiveReasoning } from "./types.js";

function chooseStrategy(perception: CognitivePerception, reasoning: CognitiveReasoning): CognitivePlan["strategy"] {
  if (perception.signals.hasCode) return "planning";
  if (perception.signals.wantsExecution) return "planning";
  if (perception.complexity === "high") return "planning";
  if (reasoning.spawn.length > 0) return "planning";
  return "direct";
}

export class PlanningEngine {
  plan(perception: CognitivePerception, reasoning: CognitiveReasoning): CognitivePlan {
    return {
      strategy: chooseStrategy(perception, reasoning),
      spawn: reasoning.spawn,
    };
  }
}

