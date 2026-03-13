import type { AgentDeps } from "../agents/agent-deps.js";

export type Reality = "digital" | "physical" | "simulated";

export class MultiRealityEngine {
  constructor(private readonly deps: AgentDeps) {}

  select(intent: any): Reality {
    if (intent.type === "iot_control") return "physical";
    if (String(intent?.entities?.simulation || "").length > 0) return "simulated";
    return "digital";
  }
}
