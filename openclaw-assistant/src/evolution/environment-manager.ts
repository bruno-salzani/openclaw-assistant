import type { AgentDeps } from "../agents/agent-deps.js";

export type Environment =
  | "local"
  | "cloud"
  | "mobile"
  | "iot"
  | "planetary"
  | "satellite"
  | "robotic"
  | "industrial"
  | "space";

export class EnvironmentManager {
  constructor(private readonly deps: AgentDeps) {}

  select(intent: any): Environment {
    if (intent.type === "iot_control") return "iot";
    if (intent.type === "app_control") return "local";
    if (intent.type === "schedule_management" || intent.type === "financial_management")
      return "cloud";
    const domain = String(intent?.entities?.domain ?? "").toLowerCase();
    if (domain.includes("satellite")) return "satellite";
    if (domain.includes("robot") || domain.includes("automation")) return "robotic";
    if (domain.includes("factory") || domain.includes("industrial")) return "industrial";
    if (domain.includes("space")) return "space";
    if (domain.includes("planetary") || domain.includes("internet")) return "planetary";
    return "cloud";
  }
}
