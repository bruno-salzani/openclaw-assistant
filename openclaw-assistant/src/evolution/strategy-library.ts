import type { AgentDeps } from "../agents/agent-deps.js";

export type Strategy = {
  id: string;
  name: string;
  description: string;
  applicability: (intent: any, context: any) => number; // 0-1 score
  execute: (context: any) => Promise<any>; // Or just return the strategy name for Coordinator
};

export class StrategyLibrary {
  private strategies: Map<string, Strategy> = new Map();

  constructor(private readonly deps: AgentDeps) {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.register({
      id: "planning",
      name: "Planning Strategy",
      description: "Decompose complex tasks into steps",
      applicability: (intent) =>
        ["schedule_management", "financial_management"].includes(intent.type) ? 0.9 : 0.3,
      execute: async () => "planning",
    });

    this.register({
      id: "direct_execution",
      name: "Direct Execution",
      description: "Execute simple commands immediately",
      applicability: (intent) =>
        ["app_control", "iot_control"].includes(intent.type) ? 0.95 : 0.1,
      execute: async () => "direct_execution",
    });

    this.register({
      id: "research",
      name: "Research Strategy",
      description: "Gather information before acting",
      applicability: (intent) => (intent.type === "unknown" ? 0.8 : 0.2),
      execute: async () => "research",
    });
  }

  register(strategy: Strategy) {
    this.strategies.set(strategy.id, strategy);
  }

  selectBestStrategy(intent: any, context: any): string {
    let bestStrategy = "research";
    let maxScore = -1;

    for (const strategy of this.strategies.values()) {
      const score = strategy.applicability(intent, context);
      if (score > maxScore) {
        maxScore = score;
        bestStrategy = strategy.id;
      }
    }

    return bestStrategy;
  }
}
