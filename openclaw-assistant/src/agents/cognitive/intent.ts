import type { AgentDeps } from "../agent-deps.js";

export type Intent = {
  type: string;
  confidence: number;
  entities: Record<string, unknown>;
};

export class IntentClassifier {
  constructor(private readonly deps: AgentDeps) {}

  async classify(text: string): Promise<Intent> {
    const lower = text.toLowerCase();

    // Heuristic Classification (Simulating LLM)
    if (lower.includes("organize") && (lower.includes("week") || lower.includes("schedule"))) {
      return {
        type: "schedule_management",
        confidence: 0.9,
        entities: { time_range: "week" },
      };
    }

    if (lower.includes("invoice") || lower.includes("finance") || lower.includes("payment")) {
      return {
        type: "financial_management",
        confidence: 0.95,
        entities: { domain: "finance" },
      };
    }

    if (lower.includes("research") || lower.includes("find") || lower.includes("search")) {
      return {
        type: "research",
        confidence: 0.85,
        entities: { query: text },
      };
    }

    if (lower.includes("open") || lower.includes("launch") || lower.includes("close")) {
      const app = text.split(" ").pop();
      return {
        type: "app_control",
        confidence: 0.9,
        entities: { action: lower.includes("open") ? "launch" : "close", app },
      };
    }

    if (lower.includes("light") || lower.includes("turn on") || lower.includes("turn off")) {
      return {
        type: "iot_control",
        confidence: 0.9,
        entities: { device: "light", state: lower.includes("on") ? "on" : "off" },
      };
    }

    return {
      type: "general_query",
      confidence: 0.5,
      entities: {},
    };
  }
}
