import type { AgentDeps } from "../agents/agent-deps.js";

export class TranslationIntelligence {
  constructor(private readonly deps: AgentDeps) {}

  translateIn(text: string): { concepts: string[] } {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const concepts = Array.from(new Set(tokens));
    return { concepts };
  }

  translateOut(payload: unknown): string {
    if (typeof payload === "string") return payload;
    return JSON.stringify(payload);
  }
}
